// Webhook da Kiwify.
//
// Segue o padrão do hubla-webhook (status por payload, variantes de telefone,
// donoDaIntegracao, dedupe de pedido, disparo de flow, Metrito). A lógica pura
// (extração, mapa de status, assinatura) fica em _shared/kiwify.mjs, coberta
// por test_kiwify.mjs.
//
// Kiwify autentica com `?signature=<hmac-sha1-hex do corpo cru>` usando o token
// da conta (secret KIWIFY_WEBHOOK_TOKEN). Não há segredo no path/header.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { donoDaIntegracao } from "../_shared/owner.ts";
import { pararNutricao } from "../_shared/stop-nurture.mjs";
import {
  extractKiwify,
  mapToFlowTrigger,
  hmacSha1Hex,
  timingSafeEqual,
  phoneVariants,
} from "../_shared/kiwify.mjs";
import {
  resolveMetritoCreds,
  sendMetritoEvent,
  sendMetritoTransaction,
  runBestEffort,
  type MetritoUtm,
} from "../_shared/metrito.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// extractKiwify vem de um .mjs sem tipos; o shape está documentado lá.
// deno-lint-ignore no-explicit-any
type Extracted = any;

async function resolveOrCreateLead(supabase: any, ex: Extracted): Promise<string | null> {
  const variantes: string[] = ex.buyerPhone ? phoneVariants(ex.buyerPhone) : [];

  let existing: any = null;
  if (variantes.length) {
    const { data } = await supabase
      .from("leads").select("id, user_id").in("phone", variantes).limit(1).maybeSingle();
    existing = data;
  }
  if (!existing && ex.buyerCpf) {
    const { data } = await supabase
      .from("leads").select("id, user_id").eq("cpf", ex.buyerCpf).limit(1).maybeSingle();
    existing = data;
  }

  if (existing) {
    await supabase.from("leads").update({
      name: ex.buyerName,
      ...(ex.buyerEmail ? { email: ex.buyerEmail } : {}),
      ...(ex.buyerCpf ? { cpf: ex.buyerCpf } : {}),
    }).eq("id", existing.id);
    return existing.id;
  }

  const dono = await donoDaIntegracao(supabase, "kiwify_owner_user_id", {
    telefones: variantes,
    email: ex.buyerEmail,
  });
  if (!dono) {
    console.error(
      `kiwify-webhook sem dono para ${ex.buyerEmail || ex.buyerPhone || "(sem contato)"}: ` +
      `configure app_settings.kiwify_owner_user_id. Lead NÃO criado.`,
    );
    return null;
  }

  if (!ex.buyerPhone) {
    // leads.phone é NOT NULL. Sem telefone não há lead; a venda ainda vai para
    // `orders` sem lead_id (mesma escolha do custom-webhook).
    console.warn("kiwify-webhook: compra sem telefone; lead não criado.");
    return null;
  }

  const { data: novo, error } = await supabase.from("leads").insert({
    name: ex.buyerName,
    phone: ex.buyerPhone,
    email: ex.buyerEmail,
    origin: "kiwify",
    user_id: dono,
    ...(ex.buyerCpf ? { cpf: ex.buyerCpf } : {}),
  }).select("id").single();
  if (error) throw error;
  return novo.id;
}

function reportToMetrito(supabase: any, ex: Extracted, leadId: string | null) {
  runBestEffort(async () => {
    let utm: MetritoUtm | null = null;
    let ownerId: string | null = null;
    if (leadId) {
      const { data: lead } = await supabase
        .from("leads").select("metadata, user_id").eq("id", leadId).maybeSingle();
      utm = (lead?.metadata?.metrito as MetritoUtm) || null;
      ownerId = lead?.user_id ?? null;
    }
    const creds = await resolveMetritoCreds(supabase, ownerId);

    await sendMetritoTransaction({
      id: ex.externalOrderId,
      status: ex.status || "pending",
      amount: ex.amount,
      currency: "BRL",
      customer: { name: ex.buyerName, email: ex.buyerEmail, phone: ex.buyerPhone },
      products: ex.kiwifyProductId || ex.productName
        ? [{ id: ex.kiwifyProductId, name: ex.productName || null }]
        : undefined,
      payment: ex.paymentMethod ? { method: ex.paymentMethod } : undefined,
      utm,
    }, creds);

    if (ex.status === "approved") {
      await sendMetritoEvent({
        name: "kiwify_purchase",
        facebookName: "Purchase",
        facebookSourceKey: "business_messaging",
        sourceKey: "whatsapp",
        idempotencyKey: "kiwify-purchase-" + ex.externalOrderId,
        value: ex.amount,
        currency: "BRL",
        lead: { email: ex.buyerEmail, phone: ex.buyerPhone, name: ex.buyerName, doc: ex.buyerCpf },
        utm,
      }, creds);
    }
  });
}

async function logWebhook(
  supabase: any, externalOrderId: string, eventStatus: string | null,
  httpStatus: number, responseMessage: string, payload: any,
) {
  try {
    await supabase.from("webhook_logs").insert({
      external_order_id: externalOrderId || null,
      event_status: eventStatus,
      http_status: httpStatus,
      response_message: responseMessage,
      payload,
    });
  } catch (e) {
    console.error("kiwify-webhook: falha ao logar webhook", e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const rawBody = await req.text();

  // ── autenticação: assinatura HMAC-SHA1 do corpo cru ──
  const secret = Deno.env.get("KIWIFY_WEBHOOK_TOKEN") || "";
  if (!secret) {
    console.error("kiwify-webhook: KIWIFY_WEBHOOK_TOKEN não configurado");
    return new Response("Server misconfigured", { status: 500, headers: corsHeaders });
  }
  const signature = (new URL(req.url).searchParams.get("signature") || "").toLowerCase();
  const expected = await hmacSha1Hex(rawBody, secret);
  if (!timingSafeEqual(signature, expected)) {
    console.error("kiwify-webhook: assinatura inválida");
    return new Response("Forbidden", { status: 403, headers: corsHeaders });
  }

  let payload: any;
  let ex: Extracted | null = null;
  try {
    payload = JSON.parse(rawBody);
    ex = extractKiwify(payload);

    if (!ex.externalOrderId) {
      await logWebhook(supabase, "", ex.status, 400, "Missing order id", payload);
      return new Response(JSON.stringify({ error: "Missing order id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── idempotência por external_order_id ──
    const { data: existingOrder } = await supabase
      .from("orders").select("id, status").eq("external_order_id", ex.externalOrderId).maybeSingle();

    if (existingOrder) {
      if (ex.status && existingOrder.status !== ex.status) {
        await supabase.from("orders")
          .update({ status: ex.status, webhook_payload: payload })
          .eq("id", existingOrder.id);
        reportToMetrito(supabase, ex, null);
      }
      await logWebhook(supabase, ex.externalOrderId, ex.status, 200, "Duplicate webhook, status updated", payload);
      return new Response(JSON.stringify({ ok: true, order_id: existingOrder.id, duplicate: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const leadId = await resolveOrCreateLead(supabase, ex);

    // dono da venda (RLS: auth.uid() = user_id)
    let donoVenda: string | null = null;
    if (leadId) {
      const { data } = await supabase.from("leads").select("user_id").eq("id", leadId).maybeSingle();
      donoVenda = data?.user_id ?? null;
    }
    if (!donoVenda) {
      donoVenda = await donoDaIntegracao(supabase, "kiwify_owner_user_id", { telefones: [], email: ex.buyerEmail });
    }

    if (ex.status && Number(ex.amount) > 0) {
      const { error: orderErr } = await supabase.from("orders").insert({
        ...(leadId ? { lead_id: leadId } : {}),
        user_id: donoVenda,
        external_order_id: ex.externalOrderId,
        amount: Number(ex.amount),
        status: ex.status,
        payment_method: ex.paymentMethod,
        platform: "kiwify",
        webhook_payload: payload,
      });
      if (orderErr && orderErr.code !== "23505") {
        console.error("kiwify-webhook: falha ao gravar venda", orderErr);
      }
    }

    reportToMetrito(supabase, ex, leadId);

    // ── compra aprovada: para a nutrição, mas só pra lead do funil zerolipedema ──
    // pararNutricao cancela QUALQUER execução em andamento do lead, sem
    // escopar por flow_id — aplicar isso a toda venda Kiwify, de qualquer
    // conta/produto, quebraria sequência de pós-venda de outros funis que
    // moram no mesmo CRM. `padrao`/`link_mapa` só existem em leads.metadata
    // para quem passou pelo binding do token do quiz zerolipedema.
    if (ex.status === "approved" && leadId) {
      const { data: leadRow } = await supabase
        .from("leads").select("metadata").eq("id", leadId).maybeSingle();
      const isLipedema = Boolean(leadRow?.metadata?.padrao || leadRow?.metadata?.link_mapa);
      if (isLipedema) {
        await pararNutricao(supabase, leadId, "comprou");
      }
    }

    // ── dispara flow pelo trigger mapeado ──
    const triggerType = mapToFlowTrigger(ex.status, ex.paymentMethod);
    if (triggerType && leadId && donoVenda) {
      try {
        const { data: flows } = await supabase
          .from("flows").select("id")
          .eq("trigger_type", triggerType).eq("active", true).eq("user_id", donoVenda);

        for (const flow of flows || []) {
          const { data: running } = await supabase
            .from("flow_executions").select("id")
            .eq("flow_id", flow.id).eq("lead_id", leadId)
            .in("status", ["running", "waiting_delay", "waiting_reply", "scheduled", "waiting_no_response"])
            .maybeSingle();
          if (running) continue;

          const { data: firstStep } = await supabase
            .from("flow_steps").select("id, step_type, delay_minutes")
            .eq("flow_id", flow.id).is("parent_step_id", null)
            .order("step_order").limit(1).maybeSingle();
          if (!firstStep) continue;

          const nextAt = firstStep.step_type === "delay"
            ? new Date(Date.now() + (firstStep.delay_minutes || 0) * 60000).toISOString()
            : new Date().toISOString();

          await supabase.from("flow_executions").insert({
            flow_id: flow.id,
            lead_id: leadId,
            current_step_id: firstStep.id,
            status: "waiting_delay",
            next_action_at: nextAt,
            metadata: {
              trigger: triggerType,
              external_order_id: ex.externalOrderId,
              product_name: ex.productName,
              amount: ex.amount,
            },
          });
        }

        if ((flows || []).length > 0) {
          await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/flow-processor`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            },
            body: JSON.stringify({ auto: true }),
          }).catch((e) => console.error("kiwify-webhook: falha ao chamar flow-processor", e));
        }
      } catch (flowErr) {
        console.error("kiwify-webhook: erro no disparo de flow (não-fatal)", flowErr);
      }
    }

    await logWebhook(supabase, ex.externalOrderId, ex.status, 200, "processed", payload);
    return new Response(
      JSON.stringify({ ok: true, lead_id: leadId, status: ex.status, trigger: triggerType }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("kiwify-webhook error:", msg);
    await logWebhook(supabase, ex?.externalOrderId || "", ex?.status || null, 500, msg, payload);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
