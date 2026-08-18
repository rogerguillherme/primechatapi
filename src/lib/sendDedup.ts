import { supabase } from "@/integrations/supabase/client";

/**
 * Deduplicação de envio: garante que o MESMO lead não receba duas vezes
 * o mesmo template / o mesmo fluxo lógico.
 *
 * Fluxos que são variações de volume da mesma campanha — ex.: "HOJE BM2 (10K)"
 * e "HOJE BM2 (2K)" — são normalizados para a MESMA chave, portanto um lead
 * que recebeu um deles nunca recebe o outro.
 */

export function normalizePhone(phone: string | null | undefined): string {
  return String(phone || "").replace(/\D/g, "");
}

/**
 * Normaliza o nome do fluxo/campanha removendo sufixos de volume e lote.
 * "HOJE BM2 (10K)" → "hoje bm2" | "HOJE BM2 (2K)" → "hoje bm2"
 */
export function normalizeCampaignGroup(name: string | null | undefined): string {
  if (!name) return "";
  return String(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ") // (10K), (2K), (cópia), (reenvio)
    .replace(/\b\d+\s*(k|mil|m)\b/g, " ")
    .replace(/\b(parte|lote|batch|bloco|copia|copy|reenvio|teste)\b\s*\d*/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+\d+$/, "")
    .trim();
}

export function flowDedupKey(flowName: string | null | undefined): string | null {
  const group = normalizeCampaignGroup(flowName);
  return group ? `camp:${group}` : null;
}

export function templateDedupKey(templateName: string | null | undefined): string | null {
  const t = String(templateName || "").trim().toLowerCase();
  return t ? `tpl:${t}` : null;
}

export interface DedupFilterResult {
  /** Leads liberados para receber */
  allowedLeadIds: string[];
  /** Leads bloqueados por já terem recebido */
  blockedLeadIds: string[];
  /** Mapa leadId → telefone normalizado (para registrar o envio depois) */
  phoneByLeadId: Record<string, string>;
}

/**
 * Filtra leads que já receberam qualquer uma das `dedupKeys`.
 * Falha aberta (não bloqueia) em caso de erro de leitura, para nunca
 * travar um disparo por indisponibilidade da consulta.
 */
export async function filterLeadsAlreadySent(
  userId: string,
  dedupKeys: string[],
  leadIds: string[],
): Promise<DedupFilterResult> {
  const phoneByLeadId: Record<string, string> = {};
  if (!userId || dedupKeys.length === 0 || leadIds.length === 0) {
    return { allowedLeadIds: leadIds, blockedLeadIds: [], phoneByLeadId };
  }

  // 1) Telefones dos leads (em lotes para evitar URLs gigantes)
  const CHUNK = 300;
  for (let i = 0; i < leadIds.length; i += CHUNK) {
    const chunk = leadIds.slice(i, i + CHUNK);
    const { data, error } = await supabase.from("leads").select("id, phone").in("id", chunk);
    if (error) {
      console.error("[sendDedup] erro ao carregar telefones:", error);
      return { allowedLeadIds: leadIds, blockedLeadIds: [], phoneByLeadId };
    }
    for (const l of data || []) phoneByLeadId[l.id] = normalizePhone(l.phone);
  }

  // 2) Telefones que já receberam alguma das chaves
  const sentPhones = new Set<string>();
  const phones = Object.values(phoneByLeadId).filter(Boolean);
  for (let i = 0; i < phones.length; i += CHUNK) {
    const chunk = phones.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("lead_send_dedup")
      .select("phone")
      .eq("user_id", userId)
      .in("dedup_key", dedupKeys)
      .in("phone", chunk);
    if (error) {
      console.error("[sendDedup] erro ao consultar dedup:", error);
      return { allowedLeadIds: leadIds, blockedLeadIds: [], phoneByLeadId };
    }
    for (const r of data || []) sentPhones.add(r.phone);
  }

  const allowedLeadIds: string[] = [];
  const blockedLeadIds: string[] = [];
  const seenInBatch = new Set<string>();
  for (const id of leadIds) {
    const phone = phoneByLeadId[id];
    if (phone && (sentPhones.has(phone) || seenInBatch.has(phone))) {
      blockedLeadIds.push(id);
      continue;
    }
    if (phone) seenInBatch.add(phone);
    allowedLeadIds.push(id);
  }

  return { allowedLeadIds, blockedLeadIds, phoneByLeadId };
}

/** Registra o envio para bloquear repetições futuras. */
export async function registerSentLeads(
  userId: string,
  dedupKeys: string[],
  leadIds: string[],
  phoneByLeadId: Record<string, string>,
  meta: { templateName?: string | null; campaignName?: string | null } = {},
): Promise<void> {
  if (!userId || dedupKeys.length === 0 || leadIds.length === 0) return;

  const rows = leadIds.flatMap((leadId) => {
    const phone = phoneByLeadId[leadId];
    if (!phone) return [];
    return dedupKeys.map((key) => ({
      user_id: userId,
      phone,
      dedup_key: key,
      lead_id: leadId,
      template_name: meta.templateName || null,
      campaign_name: meta.campaignName || null,
    }));
  });

  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase
      .from("lead_send_dedup")
      .upsert(rows.slice(i, i + CHUNK), {
        onConflict: "user_id,phone,dedup_key",
        ignoreDuplicates: true,
      });
    if (error) console.error("[sendDedup] erro ao registrar envio:", error);
  }
}
