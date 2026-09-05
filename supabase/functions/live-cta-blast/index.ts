// Disparo pontual de copy + botão CTA (cta_url) para leads com janela de 24h aberta.
// Body: { account_id, message, display_text, url, delay_min?, delay_max?, cursor?, dry_run? }
// Chunked + self-invoke para não estourar o tempo de execução.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { identificarChamador, contaPertenceAoChamador } from "../_shared/caller.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (min: number, max: number) => min + Math.random() * (max - min);
const firstName = (n: string) => (n || "").trim().split(/\s+/)[0] || "";

const CHUNK = 30;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const {
      account_id, message, display_text = "Acessar", url,
      delay_min = 4, delay_max = 8, cursor = 0, dry_run = false,
    } = await req.json();

    if (!account_id || !message || !url) {
      return json({ error: "account_id, message e url são obrigatórios" }, 400);
    }

    // Esta função dispara para TODOS os leads com janela aberta da conta, com a
    // service role, e a conta vinha só do corpo. Sem esta checagem, qualquer
    // pessoa com a anon key — que é pública, vai no bundle do front — mandava
    // uma mensagem em massa pela conta de qualquer cliente.
    const chamador = await identificarChamador(req);
    if (!(await contaPertenceAoChamador(supabase, chamador, account_id))) {
      return json({ error: "Sem permissão sobre esta conta" }, 403);
    }

    // Leads com mensagem recebida nas últimas 24h nesta conta (janela aberta)
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: inbound, error: inErr } = await supabase
      .from("chat_messages")
      .select("lead_id, created_at")
      .eq("account_id", account_id)
      .eq("direction", "inbound")
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(5000);
    if (inErr) return json({ error: inErr.message }, 500);

    const leadIds = [...new Set((inbound || []).map((r: any) => r.lead_id).filter(Boolean))];
    const { data: leads } = await supabase
      .from("leads").select("id, name, phone").in("id", leadIds);

    // Deduplica por telefone (mesma pessoa em leads duplicados)
    const byPhone = new Map<string, any>();
    for (const l of leads || []) if (l.phone && !byPhone.has(l.phone)) byPhone.set(l.phone, l);
    const targets = [...byPhone.values()].sort((a, b) => a.id.localeCompare(b.id));

    if (dry_run) return json({ ok: true, total: targets.length, sample: targets.slice(0, 5) });

    const start = Number(cursor) || 0;
    const end = Math.min(start + CHUNK, targets.length);

    // @ts-ignore EdgeRuntime
    EdgeRuntime.waitUntil((async () => {
      for (let i = start; i < end; i++) {
        const lead = targets[i];
        try {
          const body = String(message)
            .replace(/\{\{\s*nome\s*\}\}/gi, firstName(lead.name))
            .replace(/\{nome\}/gi, firstName(lead.name));

          const r = await fetch(`${supabaseUrl}/functions/v1/whatsapp-cloud-send`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
            body: JSON.stringify({
              account_id, lead_id: lead.id, phone: lead.phone,
              message: body,
              cta_url: { display_text, url },
            }),
          });
          const d = await r.json().catch(() => ({}));
          if (!r.ok || d?.error) console.error(`falha ${lead.phone}:`, JSON.stringify(d).slice(0, 300));
          else console.log(`enviado ${i + 1}/${targets.length} -> ${lead.phone}`);
        } catch (e: any) {
          console.error(`erro ${lead.phone}: ${e.message}`);
        }
        if (i < end - 1) await sleep(rand(delay_min, delay_max) * 1000);
      }

      if (end < targets.length) {
        await sleep(rand(delay_min, delay_max) * 1000);
        // IMPORTANTE: precisa de await. Sem await o worker encerra junto com o
        // waitUntil e a requisição do próximo chunk é cancelada (era por isso
        // que o disparo parava sempre no primeiro lote de 30).
        try {
          const nextRes = await fetch(`${supabaseUrl}/functions/v1/live-cta-blast`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
            body: JSON.stringify({ account_id, message, display_text, url, delay_min, delay_max, cursor: end }),
          });
          console.log(`próximo chunk (cursor=${end}) status ${nextRes.status}`);
          await nextRes.text().catch(() => "");
        } catch (e: any) {
          console.error("self-invoke falhou:", e?.message || e);
        }
      } else {
        console.log("Disparo CTA concluído");
      }
    })());

    return json({ ok: true, total: targets.length, chunk: { from: start, to: end } });
  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
});
