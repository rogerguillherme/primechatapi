// Prime Group — motor de envio das campanhas (pg_campaigns/pg_campaign_targets).
//
// Mesmo desenho do flow-processor: um cron de 1 em 1 minuto chama esta função
// com { cron: true }; ela processa um pedaço de cada campanha "agendada"/
// "enviando" dentro de um orçamento de tempo e devolve a resposta. O que não
// coube nesse minuto fica pendente pro próximo tick — não precisa de
// self-invoke nem de EdgeRuntime.waitUntil.
//
// Chamada manual do frontend: { campaign_id } com o JWT do dono, pra dar
// feedback imediato em vez de esperar até 1 minuto pelo cron.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { evoErrorMessage } from "../_shared/evo-error.mjs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (min: number, max: number) => min + Math.random() * Math.max(0, max - min);

// Cabe dentro do intervalo de 1 min do cron, com folga pra responder.
const MAX_RUN_MS = 50_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const isCron = body?.cron === true;

    let campaignIds: string[] = [];

    if (isCron) {
      const { data: due } = await supabase
        .from("pg_campaigns")
        .select("id, status, scheduled_at")
        .in("status", ["agendada", "enviando"]);
      const now = Date.now();
      campaignIds = (due || [])
        .filter((c: any) => c.status === "enviando" || !c.scheduled_at || new Date(c.scheduled_at).getTime() <= now)
        .map((c: any) => c.id);
    } else {
      const { campaign_id } = body;
      if (!campaign_id) return json({ error: "campaign_id é obrigatório" }, 400);

      const authHeader = req.headers.get("authorization") || "";
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
      if (userErr || !user) return json({ error: "Unauthorized" }, 401);

      const { data: camp } = await supabase
        .from("pg_campaigns").select("id, user_id").eq("id", campaign_id).maybeSingle();
      if (!camp || camp.user_id !== user.id) return json({ error: "Campanha não encontrada" }, 404);
      campaignIds = [campaign_id];
    }

    const startedAt = Date.now();
    const results: any[] = [];
    for (const id of campaignIds) {
      if (Date.now() - startedAt > MAX_RUN_MS) break;
      results.push({ campaign_id: id, ...(await processCampaign(supabase, id, startedAt)) });
    }

    return json({ ok: true, processed: results });
  } catch (e: any) {
    console.error("pg-campaign-dispatch erro fatal:", e);
    return json({ error: e.message }, 500);
  }
});

async function logActivity(
  supabase: any, userId: string, campaignId: string, type: string, title: string, detail: string | null,
) {
  await supabase.from("pg_activities").insert({
    user_id: userId, campaign_id: campaignId, type, title, detail,
  }).then(() => {}, () => {});
}

async function processCampaign(supabase: any, campaignId: string, startedAt: number) {
  const { data: campaign } = await supabase.from("pg_campaigns").select("*").eq("id", campaignId).maybeSingle();
  if (!campaign) return { skipped: "não encontrada" };
  if (!["agendada", "enviando"].includes(campaign.status)) return { skipped: campaign.status };

  const { data: account } = await supabase
    .from("whatsapp_accounts").select("id, phone_number_id, provider, business_account_id, api_key, access_token")
    .eq("id", campaign.account_id).maybeSingle();
  // Cada conta Evolution tem seu próprio servidor (business_account_id) e
  // chave (api_key/access_token) — mesmo padrão do evolution-groups/
  // evolution-instance. Não existe fallback global aqui de propósito: enviar
  // pelo servidor errado é pior que falhar com um erro claro.
  const serverUrl = (account?.business_account_id || "").replace(/\/+$/, "");
  const apiKey = account?.api_key || account?.access_token;
  if (!account || account.provider !== "evolution" || !serverUrl || !apiKey) {
    await supabase.from("pg_campaigns").update({ status: "falhou", updated_at: new Date().toISOString() }).eq("id", campaignId);
    await logActivity(supabase, campaign.user_id, campaignId, "erro", `Campanha "${campaign.name}" falhou`, "Instância inválida ou sem servidor/chave Evolution configurados.");
    return { finished: "falhou", motivo: "instância inválida" };
  }

  if (campaign.status === "agendada") {
    await supabase.from("pg_campaigns").update({ status: "enviando", updated_at: new Date().toISOString() }).eq("id", campaignId);
    await logActivity(supabase, campaign.user_id, campaignId, "envio", `Envio de "${campaign.name}" iniciado`, null);
  }

  const { data: targets } = await supabase
    .from("pg_campaign_targets").select("*")
    .eq("campaign_id", campaignId).eq("status", "pendente")
    .order("created_at");

  const instance = account.phone_number_id;
  let sent = campaign.sent_count || 0;
  let errors = campaign.error_count || 0;
  let processed = 0;

  const list = targets || [];
  for (; processed < list.length; processed++) {
    if (Date.now() - startedAt > MAX_RUN_MS) break;

    // Responde rápido a um "Pausar" clicado durante o processamento.
    const { data: cur } = await supabase.from("pg_campaigns").select("status").eq("id", campaignId).maybeSingle();
    if (cur?.status === "pausada") return { paused: true, sent, errors, processed };

    const target = list[processed];

    try {
      const endpoint = campaign.media_url
        ? `${serverUrl}/message/sendMedia/${instance}`
        : `${serverUrl}/message/sendText/${instance}`;
      const payload = campaign.media_url
        ? { number: target.group_jid, mediatype: campaign.media_type || "image", media: campaign.media_url, caption: campaign.message, fileName: "midia" }
        : { number: target.group_jid, text: campaign.message };

      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: apiKey },
        body: JSON.stringify(payload),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(evoErrorMessage(d, r.status));

      await supabase.from("pg_campaign_targets").update({
        status: "enviado", sent_at: new Date().toISOString(),
      }).eq("id", target.id);
      sent++;
    } catch (e: any) {
      await supabase.from("pg_campaign_targets").update({
        status: "erro", error: String(e?.message || e).slice(0, 500),
      }).eq("id", target.id);
      errors++;
    }

    await supabase.from("pg_campaigns").update({
      sent_count: sent, error_count: errors, updated_at: new Date().toISOString(),
    }).eq("id", campaignId);

    if (processed < list.length - 1) {
      await sleep(rand(campaign.interval_min, campaign.interval_max) * 1000);
    }
  }

  if (processed >= list.length) {
    const finalStatus = errors > 0 && sent === 0 ? "falhou" : "concluida";
    await supabase.from("pg_campaigns").update({
      status: finalStatus, updated_at: new Date().toISOString(),
    }).eq("id", campaignId);
    await logActivity(
      supabase, campaign.user_id, campaignId,
      finalStatus === "concluida" ? "envio" : "erro",
      `Campanha "${campaign.name}" ${finalStatus === "concluida" ? "concluída" : "falhou"}`,
      `${sent} enviados, ${errors} com erro.`,
    );

    // Não confia só no "200 OK" da Evolution na hora do envio — reconfere os
    // grupos de verdade em background (não bloqueia a resposta desta função).
    if (sent > 0) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      fetch(`${supabaseUrl}/functions/v1/pg-campaign-audit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ campaign_id: campaignId }),
      }).catch(() => {});
    }

    return { finished: finalStatus, sent, errors, processed };
  }

  return { paused_by_time_budget: true, sent, errors, processed };
}
