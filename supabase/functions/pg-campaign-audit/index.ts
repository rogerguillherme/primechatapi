// Prime Group — conferência pós-envio das campanhas.
//
// O Evolution confirmar o envio (HTTP 200) não garante que a mensagem
// chegou: a instância pode ter sido removida do grupo, o grupo pode ter
// virado "só admin" depois do último sync, ou a resposta simplesmente
// mente (mesmo padrão de falha silenciosa já visto no resto do Prime Chat).
// Quando pg-campaign-dispatch termina uma campanha, ele chama esta função,
// que reconfere cada grupo marcado "enviado" direto na Evolution:
//   1. a instância ainda está no grupo?
//   2. o grupo virou "só admin" e a instância não é admin?
//   3. o grupo mudou (nome/descrição) desde que foi sincronizado?
//   4. a última mensagem do grupo é mesmo a que mandamos?
// Grupos fora de padrão ficam marcados pra aparecer no Histórico com um
// botão "Corrigir" que reabre a campanha pré-preenchida só pra eles.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function participantPhone(p: any): string {
  if (!p) return "";
  if (typeof p === "string" || typeof p === "number") return String(p).split("@")[0].replace(/\D/g, "");
  const jid = p.id ?? p.phoneNumber ?? p.phone ?? p.jid?.id ?? "";
  return String(jid).split("@")[0].replace(/\D/g, "");
}

async function fetchGroupsWithParticipants(serverUrl: string, apiKey: string, instanceName: string) {
  const base = serverUrl.replace(/\/+$/, "").replace(/\/manager$/i, "");
  const res = await fetch(
    `${base}/group/fetchAllGroups/${encodeURIComponent(instanceName)}?getParticipants=true`,
    { headers: { apikey: apiKey, "Content-Type": "application/json" } },
  );
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const detail = body?.response?.message ?? body?.message ?? String(text).slice(0, 200);
    throw new Error(`Evolution HTTP ${res.status}: ${detail}`);
  }
  const list: any[] = Array.isArray(body) ? body : body?.groups ?? [];
  return list.map((g) => ({
    group_jid: g.id ?? g.remoteJid ?? g.jid,
    name: g.subject ?? g.name ?? "Sem nome",
    description: g.desc ?? g.description ?? null,
    announce: !!g.announce, // true = só admin manda mensagem no grupo
    participants: Array.isArray(g.participants) ? g.participants : [],
  })).filter((g) => g.group_jid);
}

/** Timestamp da última mensagem NOSSA no grupo, se a Evolution conseguir listar. */
async function lastOutgoingMessageAt(
  serverUrl: string, apiKey: string, instanceName: string, groupJid: string,
): Promise<Date | null> {
  const base = serverUrl.replace(/\/+$/, "").replace(/\/manager$/i, "");
  const res = await fetch(`${base}/chat/findMessages/${encodeURIComponent(instanceName)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: apiKey },
    body: JSON.stringify({ where: { key: { remoteJid: groupJid, fromMe: true } }, limit: 5 }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ao ler mensagens do grupo`);
  const body = await res.json().catch(() => null);
  const records: any[] = Array.isArray(body) ? body : body?.messages?.records ?? body?.records ?? [];
  const timestamps = records
    .map((m) => Number(m?.messageTimestamp) || 0)
    .filter((t) => t > 0);
  if (timestamps.length === 0) return null;
  return new Date(Math.max(...timestamps) * 1000);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const { campaign_id } = body;
    if (!campaign_id) return json({ error: "campaign_id é obrigatório" }, 400);

    // Chamada interna (pg-campaign-dispatch) usa a própria service role;
    // chamada manual do frontend precisa provar que é o dono da campanha.
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (token !== serviceKey) {
      const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
      if (userErr || !user) return json({ error: "Unauthorized" }, 401);
      const { data: camp } = await supabase.from("pg_campaigns").select("user_id").eq("id", campaign_id).maybeSingle();
      if (!camp || camp.user_id !== user.id) return json({ error: "Campanha não encontrada" }, 404);
    }

    const { data: campaign } = await supabase.from("pg_campaigns").select("*").eq("id", campaign_id).maybeSingle();
    if (!campaign) return json({ error: "Campanha não encontrada" }, 404);

    const { data: account } = await supabase
      .from("whatsapp_accounts")
      .select("id, phone_number_id, display_phone_number, business_account_id, api_key, access_token, provider")
      .eq("id", campaign.account_id).maybeSingle();
    const serverUrl = (account?.business_account_id || "").replace(/\/+$/, "");
    const apiKey = account?.api_key || account?.access_token;
    if (!account || account.provider !== "evolution" || !serverUrl || !apiKey) {
      return json({ error: "Instância inválida para conferência" }, 400);
    }

    const { data: targets } = await supabase
      .from("pg_campaign_targets").select("*")
      .eq("campaign_id", campaign_id).eq("status", "enviado");
    const list = targets || [];
    if (list.length === 0) return json({ ok: true, checked: 0 });

    let groups: Awaited<ReturnType<typeof fetchGroupsWithParticipants>>;
    try {
      groups = await fetchGroupsWithParticipants(serverUrl, apiKey, account.phone_number_id);
    } catch (e: any) {
      // Sem isso os alvos ficariam "pendente" de checagem pra sempre, de
      // forma invisível — melhor marcar como "não conferido" e explicar.
      const nota = `Não foi possível conferir os grupos: ${e?.message || e}`;
      for (const t of list) {
        await supabase.from("pg_campaign_targets").update({
          check_status: "erro_checagem", check_detail: nota, checked_at: new Date().toISOString(),
        }).eq("id", t.id);
      }
      return json({ ok: false, error: nota, checked: 0 });
    }
    const groupByJid = new Map(groups.map((g) => [g.group_jid, g]));

    const { data: known } = await supabase
      .from("whatsapp_groups").select("group_jid, name, description").eq("account_id", account.id);
    const knownByJid = new Map((known || []).map((g: any) => [g.group_jid, g]));

    const ownPhone = String(account.display_phone_number || "").replace(/\D/g, "");

    let ok = 0, foraPadrao = 0;

    for (const target of list) {
      const motivos: string[] = [];
      const group = groupByJid.get(target.group_jid);

      if (!group) {
        motivos.push("A instância não aparece mais nesse grupo (saiu, foi removida, ou o grupo foi excluído).");
      } else {
        if (ownPhone) {
          const eu = group.participants.find((p: any) => participantPhone(p) === ownPhone);
          if (!eu) {
            motivos.push("A instância não está mais na lista de participantes do grupo.");
          } else if (group.announce && !eu.admin) {
            motivos.push("O grupo virou 'somente admins' e a instância não é admin — o envio pode ter sido rejeitado.");
          }
        }
        const salvo = knownByJid.get(target.group_jid);
        if (salvo && (salvo.name !== group.name || (salvo.description || "") !== (group.description || ""))) {
          motivos.push("O grupo mudou de nome/descrição desde a última sincronização.");
        }

        try {
          const ultima = await lastOutgoingMessageAt(serverUrl, apiKey, account.phone_number_id, target.group_jid);
          const enviadoEm = target.sent_at ? new Date(target.sent_at).getTime() : 0;
          if (!ultima || ultima.getTime() < enviadoEm - 60_000) {
            motivos.push("Não encontramos a mensagem enviada no histórico recente do grupo.");
          }
        } catch (e: any) {
          motivos.push(`Não foi possível confirmar a mensagem no grupo (${e?.message || "erro"}).`);
        }
      }

      const status = motivos.length > 0 ? "fora_padrao" : "ok";
      if (status === "ok") ok++; else foraPadrao++;

      await supabase.from("pg_campaign_targets").update({
        check_status: status,
        check_detail: motivos.join(" ") || null,
        checked_at: new Date().toISOString(),
      }).eq("id", target.id);
    }

    if (foraPadrao > 0) {
      await supabase.from("pg_activities").insert({
        user_id: campaign.user_id,
        campaign_id,
        type: "erro",
        title: `Conferência de "${campaign.name}": ${foraPadrao} grupo(s) fora de padrão`,
        detail: `${ok} ok de ${list.length} conferidos.`,
      });
    }

    return json({ ok: true, checked: list.length, ok_count: ok, fora_padrao: foraPadrao });
  } catch (e: any) {
    console.error("pg-campaign-audit erro fatal:", e);
    return json({ error: e.message }, 500);
  }
});
