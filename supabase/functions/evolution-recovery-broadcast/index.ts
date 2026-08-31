// Evolution Recovery Broadcast — disparo seguro para reativação de leads
// (carrinho abandonado / PIX antigo) via Evolution API.
//
// Anti-ban: shuffle, delay aleatório, 3 templates, sufixo zero-width, pause em erros.
// Resume-friendly: processa em chunks de N leads por invocação e re-invoca a si mesma
// (evita shutdown do EdgeRuntime durante long sleeps).
//
// Body:
//  - Iniciar:  { account_id, lead_ids, image_url?, delay_min?, delay_max?, dry_run? }
//  - Retomar:  { resume_job_id }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { evoErrorMessage } from "../_shared/evo-error.mjs";

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

const TEMPLATES = [
  (n: string, link: string) =>
    `Oi ${n}! 👋\n\nVi aqui que você chegou a *gerar seu PIX* da nossa formação, mas o pagamento acabou não sendo concluído na época.\n\nA boa notícia: *sua vaga ainda está reservada* 🔒\n\nReabri seu link agora — é só clicar abaixo pra finalizar de onde parou:\n${link}\n\nQualquer dúvida, é só me responder por aqui. 💜`,
  (n: string, link: string) =>
    `Olá ${n}, tudo bem? 🙂\n\nDando uma olhada no histórico, percebi que você *começou sua matrícula* mas não chegou a finalizar o pagamento.\n\nReservei seu acesso novamente e liberei o link pra você concluir hoje:\n${link}\n\nSe precisar de ajuda em qualquer etapa, é só me chamar. 🚀`,
  (n: string, link: string) =>
    `Eaí ${n}! 😉\n\nLembra que você *iniciou seu cadastro* na Fábrica e o checkout ficou em aberto?\n\nReabri sua vaga — ainda dá tempo de garantir o acesso pelo mesmo link:\n${link}\n\nMe avisa se quiser que eu te explique o passo a passo. 💪`,
];

// Quantos leads processar por invocação. Mantém abaixo do timeout do EdgeRuntime.
// Com delay 30-90s, 8 leads = ~4-12 min, dentro do limite seguro.
const CHUNK_SIZE = 8;

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
    let delay_min: number;
    let delay_max: number;
    let dry_run = false;

    if (resume_job_id) {
      // ==== MODO RESUME ====
      const { data: jobRow } = await supabase
        .from("broadcast_jobs")
        .select("*")
        .eq("id", resume_job_id)
        .maybeSingle();
      if (!jobRow) return json({ error: "Job não encontrado" }, 404);
      if (jobRow.status === "completed" || jobRow.status === "cancelled") {
        return json({ ok: true, message: `Job já está ${jobRow.status}`, job_id: resume_job_id });
      }
      job = jobRow;
      delay_min = jobRow.delay_min_seconds;
      delay_max = jobRow.delay_max_seconds;

      const { data: acc } = await supabase
        .from("whatsapp_accounts")
        .select("id, name, phone_number_id, provider, user_id")
        .eq("id", jobRow.account_id)
        .maybeSingle();
      if (!acc) return json({ error: "Conta não encontrada" }, 404);
      account = acc;

      // Mantém ordem original (lead_ids já foi embaralhado na criação)
      const { data: ls } = await supabase
        .from("leads")
        .select("id, name, phone")
        .in("id", jobRow.lead_ids);
      if (!ls) return json({ error: "Leads não encontrados" }, 404);
      // reordena conforme lead_ids original
      const leadMap = new Map(ls.map((l: any) => [l.id, l]));
      leads = jobRow.lead_ids.map((id: string) => leadMap.get(id)).filter(Boolean);

      // image_url salvo em retry_map.image_url
      image_url = jobRow.retry_map?.image_url;

      await supabase.from("broadcast_jobs").update({
        status: "processing",
        pause_reason: null,
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);
    } else {
      // ==== MODO INICIAR ====
      const { account_id, lead_ids, image_url: img, delay_min: dmin = 30, delay_max: dmax = 90, dry_run: dr = false } = body;
      delay_min = dmin;
      delay_max = dmax;
      dry_run = dr;
      image_url = img;

      if (!account_id || !Array.isArray(lead_ids) || lead_ids.length === 0) {
        return json({ error: "account_id e lead_ids são obrigatórios" }, 400);
      }

      const { data: acc } = await supabase
        .from("whatsapp_accounts")
        .select("id, name, phone_number_id, provider, user_id")
        .eq("id", account_id)
        .maybeSingle();
      if (!acc || acc.provider !== "evolution") return json({ error: "Conta Evolution inválida" }, 400);
      account = acc;

      const { data: ls } = await supabase
        .from("leads")
        .select("id, name, phone")
        .in("id", lead_ids);
      if (!ls || ls.length === 0) return json({ error: "Nenhum lead encontrado" }, 404);

      // Embaralha agora e persiste a ordem em lead_ids
      const shuffled = [...ls].sort(() => Math.random() - 0.5);
      leads = shuffled;
      const orderedIds = shuffled.map((l) => l.id);

      const { data: created, error: jobErr } = await supabase
        .from("broadcast_jobs")
        .insert({
          user_id: acc.user_id,
          account_id,
          lead_ids: orderedIds,
          total_leads: shuffled.length,
          status: dry_run ? "completed" : "processing",
          delay_min_seconds: delay_min,
          delay_max_seconds: delay_max,
          shuffle_leads: true,
          template_name: "recovery_evolution",
          messages_per_second: 0,
          retry_map: { image_url: image_url || null },
        })
        .select("*")
        .single();
      if (jobErr) return json({ error: jobErr.message }, 500);
      job = created;

      if (dry_run) return json({ ok: true, job_id: job.id, total: shuffled.length, dry_run: true });
    }

    const instance = account.phone_number_id;
    const userId = account.user_id;
    const baseUrl = evoServerUrl.replace(/\/+$/, "");
    const startCursor: number = job.last_cursor || 0;
    const endCursor = Math.min(startCursor + CHUNK_SIZE, leads.length);

    // Processa em background apenas o chunk
    // @ts-ignore EdgeRuntime
    EdgeRuntime.waitUntil((async () => {
      let sent = job.sent_count || 0;
      let errors = job.error_count || 0;
      let consecutive = job.consecutive_errors || 0;

      for (let i = startCursor; i < endCursor; i++) {
        const lead = leads[i];
        if (!lead) continue;

        // pause check
        const { data: cur } = await supabase
          .from("broadcast_jobs").select("status").eq("id", job.id).maybeSingle();
        if (cur?.status === "cancelled" || cur?.status === "paused") {
          console.log("Job pausado/cancelado, saindo");
          return;
        }

        if (consecutive >= 5) {
          await supabase.from("broadcast_jobs").update({
            status: "paused_by_system",
            pause_reason: "5 erros consecutivos",
            updated_at: new Date().toISOString(),
          }).eq("id", job.id);
          return;
        }

        // Idempotência: pula se já enviado para esse lead neste job
        const { data: prior } = await supabase
          .from("message_logs")
          .select("id")
          .eq("job_id", job.id)
          .eq("lead_id", lead.id)
          .eq("status", "sent")
          .limit(1)
          .maybeSingle();
        if (prior) {
          console.log(`Skip duplicado lead ${lead.phone} (já enviado neste job)`);
          await supabase.from("broadcast_jobs").update({
            last_cursor: i + 1, updated_at: new Date().toISOString(),
          }).eq("id", job.id);
          continue;
        }

        const fname = firstName(lead.name);
        const tpl = TEMPLATES[i % TEMPLATES.length];
        const link = `https://hub.la/r/oferta-aqui-fabrica`;
        const text = tpl(fname, link) + zwSig();

        try {
          if (image_url) {
            const r = await fetch(`${baseUrl}/message/sendMedia/${instance}`, {
              method: "POST",
              headers: { "Content-Type": "application/json", apikey: evoApiKey },
              body: JSON.stringify({
                number: lead.phone, mediatype: "image", media: image_url, caption: text, fileName: "convite.png",
              }),
            });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(`sendMedia: ${evoErrorMessage(d, r.status)}`);
          } else {
            const r = await fetch(`${baseUrl}/message/sendText/${instance}`, {
              method: "POST",
              headers: { "Content-Type": "application/json", apikey: evoApiKey },
              body: JSON.stringify({ number: lead.phone, text }),
            });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(`sendText: ${evoErrorMessage(d, r.status)}`);
          }

          await supabase.from("chat_messages").insert({
            lead_id: lead.id, account_id: account.id, direction: "outbound",
            content: text, media_url: image_url || null, media_type: image_url ? "image" : null, status: "sent",
          });
          await supabase.from("message_logs").insert({
            user_id: userId, job_id: job.id, account_id: account.id, lead_id: lead.id,
            phone: lead.phone, status: "sent", sent_at: new Date().toISOString(),
          });

          sent++;
          consecutive = 0;
          await supabase.from("broadcast_jobs").update({
            sent_count: sent, error_count: errors, last_cursor: i + 1, consecutive_errors: 0,
            updated_at: new Date().toISOString(),
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

        // Delay anti-ban entre mensagens do chunk
        if (i < endCursor - 1) {
          await sleep(rand(delay_min, delay_max) * 1000);
        }
      }

      // Fim do chunk: ou completa, ou re-invoca para continuar
      if (endCursor >= leads.length) {
        await supabase.from("broadcast_jobs").update({
          status: "completed", sent_count: sent, error_count: errors,
          updated_at: new Date().toISOString(),
        }).eq("id", job.id);
        console.log(`Broadcast concluído: ${sent} enviados, ${errors} erros`);
      } else {
        // delay curto entre chunks + self-invoke
        await sleep(rand(delay_min, delay_max) * 1000);
        const url = `${supabaseUrl}/functions/v1/evolution-recovery-broadcast`;
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({ resume_job_id: job.id }),
        }).catch((err) => console.error("Self-invoke falhou:", err));
        console.log(`Chunk concluído (cursor ${endCursor}/${leads.length}), re-invocando...`);
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
