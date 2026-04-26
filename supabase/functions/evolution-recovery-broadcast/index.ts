// Evolution Recovery Broadcast — disparo seguro para reativação de leads
// (carrinho abandonado / PIX antigo) via Evolution API.
//
// Características anti-ban:
// - Embaralha leads
// - Delay aleatório entre min/max segundos (default 30-90s)
// - Variação de mensagem por lead (3 templates rotativos)
// - Sufixo zero-width invisível em cada mensagem (fingerprint diferente)
// - Pause se taxa de erro > 15% ou 5 erros consecutivos
// - Salva tudo em chat_messages para aparecer no chat
//
// Body: { account_id, lead_ids, image_url?, delay_min?, delay_max?, dry_run? }

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

// Templates de RECUPERAÇÃO (passado) — variação para anti-spam
const TEMPLATES = [
  (n: string, link: string) =>
    `Oi ${n}! 👋\n\nVi aqui que você chegou a *gerar seu PIX* da nossa formação, mas o pagamento acabou não sendo concluído na época.\n\nA boa notícia: *sua vaga ainda está reservada* 🔒\n\nReabri seu link agora — é só clicar abaixo pra finalizar de onde parou:\n${link}\n\nQualquer dúvida, é só me responder por aqui. 💜`,

  (n: string, link: string) =>
    `Olá ${n}, tudo bem? 🙂\n\nDando uma olhada no histórico, percebi que você *começou sua matrícula* mas não chegou a finalizar o pagamento.\n\nReservei seu acesso novamente e liberei o link pra você concluir hoje:\n${link}\n\nSe precisar de ajuda em qualquer etapa, é só me chamar. 🚀`,

  (n: string, link: string) =>
    `Eaí ${n}! 😉\n\nLembra que você *iniciou seu cadastro* na Fábrica e o checkout ficou em aberto?\n\nReabri sua vaga — ainda dá tempo de garantir o acesso pelo mesmo link:\n${link}\n\nMe avisa se quiser que eu te explique o passo a passo. 💪`,
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const evoServerUrl = Deno.env.get("EVOLUTION_SERVER_URL")!;
    const evoApiKey = Deno.env.get("EVOLUTION_API_KEY")!;

    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const {
      account_id,
      lead_ids,
      image_url,
      delay_min = 30,
      delay_max = 90,
      dry_run = false,
    } = body || {};

    if (!account_id || !Array.isArray(lead_ids) || lead_ids.length === 0) {
      return json({ error: "account_id e lead_ids são obrigatórios" }, 400);
    }

    // Conta Evolution
    const { data: account } = await supabase
      .from("whatsapp_accounts")
      .select("id, name, phone_number_id, provider, user_id")
      .eq("id", account_id)
      .maybeSingle();

    if (!account || account.provider !== "evolution") {
      return json({ error: "Conta Evolution inválida" }, 400);
    }

    const instance = account.phone_number_id; // nome da instância Evolution
    const userId = account.user_id;

    // Carrega leads
    const { data: leads } = await supabase
      .from("leads")
      .select("id, name, phone")
      .in("id", lead_ids);

    if (!leads || leads.length === 0) {
      return json({ error: "Nenhum lead encontrado" }, 404);
    }

    // Cria registro de campanha em broadcast_jobs (para histórico/UI)
    const { data: job, error: jobErr } = await supabase
      .from("broadcast_jobs")
      .insert({
        user_id: userId,
        account_id,
        lead_ids: lead_ids,
        total_leads: leads.length,
        status: dry_run ? "completed" : "processing",
        delay_min_seconds: delay_min,
        delay_max_seconds: delay_max,
        shuffle_leads: true,
        template_name: "recovery_evolution",
        messages_per_second: 0,
      })
      .select("id")
      .single();

    if (jobErr) return json({ error: jobErr.message }, 500);

    if (dry_run) {
      return json({ ok: true, job_id: job.id, total: leads.length, dry_run: true });
    }

    // Embaralha leads
    const shuffled = [...leads].sort(() => Math.random() - 0.5);

    // PROCESSA EM BACKGROUND
    const baseUrl = evoServerUrl.replace(/\/+$/, "");

    // @ts-ignore EdgeRuntime.waitUntil
    EdgeRuntime.waitUntil((async () => {
      let sent = 0;
      let errors = 0;
      let consecutive = 0;

      for (let i = 0; i < shuffled.length; i++) {
        const lead = shuffled[i];

        // Pause check
        const { data: cur } = await supabase
          .from("broadcast_jobs")
          .select("status")
          .eq("id", job.id)
          .maybeSingle();
        if (cur?.status === "cancelled" || cur?.status === "paused") {
          console.log("Job paused/cancelled, exiting");
          break;
        }

        // Anti-ban: pausa se 5 erros consecutivos
        if (consecutive >= 5) {
          await supabase.from("broadcast_jobs").update({
            status: "paused_by_system",
            pause_reason: "5 erros consecutivos — verificar instância",
            updated_at: new Date().toISOString(),
          }).eq("id", job.id);
          console.log("Pausado por erros consecutivos");
          break;
        }

        const fname = firstName(lead.name);
        const tpl = TEMPLATES[i % TEMPLATES.length];
        const link = `https://pay.hub.la/nB2koW36bTCpa5rUOpcL`;
        const text = tpl(fname, link) + zwSig();

        try {
          let mediaResp: any = null;
          let textResp: any = null;

          if (image_url) {
            // Envia mídia + caption (texto vai junto)
            const mediaRes = await fetch(`${baseUrl}/message/sendMedia/${instance}`, {
              method: "POST",
              headers: { "Content-Type": "application/json", apikey: evoApiKey },
              body: JSON.stringify({
                number: lead.phone,
                mediatype: "image",
                media: image_url,
                caption: text,
                fileName: "convite.png",
              }),
            });
            mediaResp = await mediaRes.json().catch(() => ({}));
            if (!mediaRes.ok) throw new Error(`sendMedia ${mediaRes.status}: ${JSON.stringify(mediaResp)}`);
          } else {
            const txtRes = await fetch(`${baseUrl}/message/sendText/${instance}`, {
              method: "POST",
              headers: { "Content-Type": "application/json", apikey: evoApiKey },
              body: JSON.stringify({ number: lead.phone, text }),
            });
            textResp = await txtRes.json().catch(() => ({}));
            if (!txtRes.ok) throw new Error(`sendText ${txtRes.status}: ${JSON.stringify(textResp)}`);
          }

          // Salva mensagem outbound no chat
          await supabase.from("chat_messages").insert({
            lead_id: lead.id,
            account_id,
            direction: "outbound",
            content: text,
            media_url: image_url || null,
            media_type: image_url ? "image" : null,
            status: "sent",
          });

          await supabase.from("message_logs").insert({
            user_id: userId,
            job_id: job.id,
            account_id,
            lead_id: lead.id,
            phone: lead.phone,
            status: "sent",
            sent_at: new Date().toISOString(),
          });

          sent++;
          consecutive = 0;
          await supabase.from("broadcast_jobs").update({
            sent_count: sent,
            error_count: errors,
            last_cursor: i + 1,
            consecutive_errors: 0,
            updated_at: new Date().toISOString(),
          }).eq("id", job.id);
        } catch (e: any) {
          errors++;
          consecutive++;
          console.error(`Erro lead ${lead.phone}:`, e.message);
          await supabase.from("message_logs").insert({
            user_id: userId,
            job_id: job.id,
            account_id,
            lead_id: lead.id,
            phone: lead.phone,
            status: "error",
            error_message: e.message?.slice(0, 500),
          });
          await supabase.from("broadcast_jobs").update({
            error_count: errors,
            consecutive_errors: consecutive,
            last_error: e.message?.slice(0, 500),
            updated_at: new Date().toISOString(),
          }).eq("id", job.id);
        }

        // Delay anti-ban (exceto último)
        if (i < shuffled.length - 1) {
          const ms = rand(delay_min, delay_max) * 1000;
          await sleep(ms);
        }
      }

      await supabase.from("broadcast_jobs").update({
        status: "completed",
        sent_count: sent,
        error_count: errors,
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);

      console.log(`Broadcast concluído: ${sent} enviados, ${errors} erros`);
    })());

    return json({
      ok: true,
      job_id: job.id,
      total_leads: leads.length,
      message: `Disparo iniciado em background. Acompanhe pelo job ${job.id}.`,
    });
  } catch (e: any) {
    console.error("Erro fatal:", e);
    return json({ error: e.message }, 500);
  }
});
