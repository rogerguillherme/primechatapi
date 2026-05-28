// Evolution Bulk Broadcast — disparo em massa com mensagem customizada do usuário.
// Anti-ban: shuffle, delay aleatório, sufixo zero-width, pause em erros consecutivos.
// Resume-friendly: chunks + self-invoke.
//
// Body iniciar:  { account_id, lead_ids, message, image_url?, delay_min?, delay_max? }
// Body retomar:  { resume_job_id }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const ZW = ["\u200B", "\u200C", "\u200D", "\u2060"];
const zwSig = () => Array.from({ length: 6 }, () => ZW[Math.floor(Math.random() * ZW.length)]).join("");
const firstName = (n: string) => (n || "").trim().split(/\s+/)[0] || "amigo(a)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (min: number, max: number) => min + Math.random() * (max - min);

// substitui {nome}, {primeiro_nome}, {telefone}
const renderTemplate = (tpl: string, lead: { name: string; phone: string }) =>
  tpl
    .replace(/\{nome\}/gi, lead.name || "")
    .replace(/\{primeiro_nome\}/gi, firstName(lead.name))
    .replace(/\{telefone\}/gi, lead.phone || "");

const CHUNK_SIZE = 80;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const evoServerUrl = Deno.env.get("EVOLUTION_SERVER_URL")!;
    const evoApiKey = Deno.env.get("EVOLUTION_API_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const { resume_job_id } = body || {};

    let job: any;
    let leads: any[];
    let account: any;
    let image_url: string | undefined;
    let messageTpls: string[]; // suporta rotação: cada lead recebe messageTpls[i % messageTpls.length]
    let delay_min: number;
    let delay_max: number;

    if (resume_job_id) {
      const { data: jobRow } = await supabase
        .from("broadcast_jobs").select("*").eq("id", resume_job_id).maybeSingle();
      if (!jobRow) return json({ error: "Job não encontrado" }, 404);
      if (jobRow.status === "completed" || jobRow.status === "cancelled") {
        return json({ ok: true, message: `Job já está ${jobRow.status}`, job_id: resume_job_id });
      }
      job = jobRow;
      delay_min = jobRow.delay_min_seconds;
      delay_max = jobRow.delay_max_seconds;
      // Suporta novo formato (messages: string[]) e legado (message: string)
      const storedMessages = jobRow.retry_map?.messages;
      messageTpls = Array.isArray(storedMessages) && storedMessages.length > 0
        ? storedMessages.map((m: any) => String(m))
        : [jobRow.retry_map?.message || ""];
      image_url = jobRow.retry_map?.image_url;

      const { data: acc } = await supabase
        .from("whatsapp_accounts")
        .select("id, name, phone_number_id, provider, user_id")
        .eq("id", jobRow.account_id).maybeSingle();
      if (!acc) return json({ error: "Conta não encontrada" }, 404);
      account = acc;

      // Garante que apenas leads do mesmo dono da conta sejam enviados
      const { data: ls } = await supabase
        .from("leads").select("id, name, phone, user_id")
        .in("id", jobRow.lead_ids).eq("user_id", account.user_id);
      const leadMap = new Map((ls || []).map((l: any) => [l.id, l]));
      leads = jobRow.lead_ids.map((id: string) => leadMap.get(id)).filter(Boolean);

      await supabase.from("broadcast_jobs").update({
        status: "processing", pause_reason: null, updated_at: new Date().toISOString(),
      }).eq("id", job.id);
    } else {
      // Validar JWT do usuário
      const authHeader = req.headers.get("authorization") || "";
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      const adminClient = createClient(supabaseUrl, serviceKey);
      const { data: { user }, error: userErr } = await adminClient.auth.getUser(token);
      if (userErr || !user) return json({ error: "Unauthorized" }, 401);

      const {
        account_id, lead_ids, message, messages, image_url: img,
        delay_min: dmin = 5, delay_max: dmax = 5,
      } = body;
      if (!account_id || !Array.isArray(lead_ids) || lead_ids.length === 0) {
        return json({ error: "account_id e lead_ids são obrigatórios" }, 400);
      }
      // Normaliza para array
      const incomingMsgs: string[] = Array.isArray(messages) && messages.length > 0
        ? messages.map((m: any) => String(m || "")).filter((m: string) => m.trim().length > 0)
        : (typeof message === "string" && message.trim().length > 0 ? [message] : []);
      if (incomingMsgs.length === 0) {
        return json({ error: "message ou messages é obrigatório" }, 400);
      }
      if (incomingMsgs.some((m) => m.length > 4000)) {
        return json({ error: "mensagem muito longa (máx 4000)" }, 400);
      }

      delay_min = Math.max(0, parseInt(dmin) || 5);
      delay_max = Math.max(delay_min, parseInt(dmax) || 5);
      image_url = img || undefined;
      messageTpls = incomingMsgs;

      const { data: acc } = await supabase
        .from("whatsapp_accounts")
        .select("id, name, phone_number_id, provider, user_id")
        .eq("id", account_id).eq("user_id", user.id).maybeSingle();
      if (!acc) return json({ error: "Conta não encontrada ou sem permissão" }, 403);
      if (acc.provider !== "evolution") return json({ error: "Esta função só funciona com WhatsApp não-API (Evolution)" }, 400);
      account = acc;

      const { data: ls } = await supabase
        .from("leads").select("id, name, phone")
        .eq("user_id", user.id).in("id", lead_ids);
      if (!ls || ls.length === 0) return json({ error: "Nenhum lead encontrado" }, 404);

      const shuffled = [...ls].sort(() => Math.random() - 0.5);
      leads = shuffled;
      const orderedIds = shuffled.map((l) => l.id);

      const { data: created, error: jobErr } = await supabase
        .from("broadcast_jobs").insert({
          user_id: acc.user_id,
          account_id,
          lead_ids: orderedIds,
          total_leads: shuffled.length,
          status: "processing",
          delay_min_seconds: delay_min,
          delay_max_seconds: delay_max,
          shuffle_leads: true,
          template_name: "bulk_evolution_custom",
          messages_per_second: 0,
          retry_map: { image_url: image_url || null, message: messageTpl },
        })
        .select("*").single();
      if (jobErr) return json({ error: jobErr.message }, 500);
      job = created;
    }

    const instance = account.phone_number_id;
    const userId = account.user_id;
    const baseUrl = evoServerUrl.replace(/\/+$/, "");
    const startCursor: number = job.last_cursor || 0;
    const endCursor = Math.min(startCursor + CHUNK_SIZE, leads.length);

    // @ts-ignore EdgeRuntime
    EdgeRuntime.waitUntil((async () => {
      let sent = job.sent_count || 0;
      let errors = job.error_count || 0;
      let consecutive = job.consecutive_errors || 0;

      for (let i = startCursor; i < endCursor; i++) {
        const lead = leads[i];
        if (!lead) continue;

        const { data: cur } = await supabase
          .from("broadcast_jobs").select("status").eq("id", job.id).maybeSingle();
        if (cur?.status === "cancelled" || cur?.status === "paused") return;

        if (consecutive >= 5) {
          await supabase.from("broadcast_jobs").update({
            status: "paused_by_system",
            pause_reason: "5 erros consecutivos",
            updated_at: new Date().toISOString(),
          }).eq("id", job.id);
          return;
        }

        // Idempotência
        const { data: prior } = await supabase
          .from("message_logs").select("id")
          .eq("job_id", job.id).eq("lead_id", lead.id).eq("status", "sent")
          .limit(1).maybeSingle();
        if (prior) {
          await supabase.from("broadcast_jobs").update({
            last_cursor: i + 1, updated_at: new Date().toISOString(),
          }).eq("id", job.id);
          continue;
        }

        const text = renderTemplate(messageTpl, lead) + zwSig();

        try {
          if (image_url) {
            const r = await fetch(`${baseUrl}/message/sendMedia/${instance}`, {
              method: "POST",
              headers: { "Content-Type": "application/json", apikey: evoApiKey },
              body: JSON.stringify({
                number: lead.phone, mediatype: "image", media: image_url,
                caption: text, fileName: "imagem.png",
              }),
            });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(`sendMedia ${r.status}: ${JSON.stringify(d)}`);
          } else {
            const r = await fetch(`${baseUrl}/message/sendText/${instance}`, {
              method: "POST",
              headers: { "Content-Type": "application/json", apikey: evoApiKey },
              body: JSON.stringify({ number: lead.phone, text }),
            });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(`sendText ${r.status}: ${JSON.stringify(d)}`);
          }

          await supabase.from("chat_messages").insert({
            lead_id: lead.id, account_id: account.id, direction: "outbound",
            content: text, media_url: image_url || null,
            media_type: image_url ? "image" : null, status: "sent",
          });
          await supabase.from("message_logs").insert({
            user_id: userId, job_id: job.id, account_id: account.id, lead_id: lead.id,
            phone: lead.phone, status: "sent", sent_at: new Date().toISOString(),
          });

          sent++;
          consecutive = 0;
          await supabase.from("broadcast_jobs").update({
            sent_count: sent, error_count: errors, last_cursor: i + 1,
            consecutive_errors: 0, updated_at: new Date().toISOString(),
          }).eq("id", job.id);
        } catch (e: any) {
          errors++;
          consecutive++;
          console.error(`Erro lead ${lead.phone}:`, e.message);
          await supabase.from("message_logs").insert({
            user_id: userId, job_id: job.id, account_id: account.id, lead_id: lead.id,
            phone: lead.phone, status: "error", error_message: e.message?.slice(0, 500),
          });
          await supabase.from("broadcast_jobs").update({
            error_count: errors, consecutive_errors: consecutive, last_cursor: i + 1,
            last_error: e.message?.slice(0, 500), updated_at: new Date().toISOString(),
          }).eq("id", job.id);
        }

        if (i < endCursor - 1) await sleep(rand(delay_min, delay_max) * 1000);
      }

      if (endCursor >= leads.length) {
        await supabase.from("broadcast_jobs").update({
          status: "completed", sent_count: sent, error_count: errors,
          updated_at: new Date().toISOString(),
        }).eq("id", job.id);
      } else {
        await sleep(rand(delay_min, delay_max) * 1000);
        const url = `${supabaseUrl}/functions/v1/evolution-bulk-broadcast`;
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({ resume_job_id: job.id }),
        }).catch((err) => console.error("Self-invoke falhou:", err));
      }
    })());

    return json({
      ok: true, job_id: job.id, total_leads: leads.length,
      chunk: { from: startCursor, to: endCursor },
      message: resume_job_id ? "Retomando disparo" : "Disparo iniciado",
    });
  } catch (e: any) {
    console.error("Erro fatal:", e);
    return json({ error: e.message }, 500);
  }
});
