import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  // Ensure Brazilian country code 55 prefix
  if (digits.startsWith("55")) return digits;
  return "55" + digits;
}

function normalizeCpf(cpf: string): string {
  return cpf.replace(/\D/g, "");
}

function mapHublaStatus(type: string, invoiceStatus: string): string {
  if (type === "invoice.payment_succeeded" || invoiceStatus === "paid") return "approved";
  if (type === "invoice.refunded" || invoiceStatus === "refunded") return "refunded";
  if (type === "invoice.chargeback" || invoiceStatus === "chargeback") return "chargeback";
  if (type === "invoice.cancelled" || invoiceStatus === "cancelled") return "cancelled";
  if (type === "invoice.payment_failed" || invoiceStatus === "failed") return "failed";
  if (type === "invoice.expired" || invoiceStatus === "expired") return "expired";
  if (type === "checkout.abandoned" || invoiceStatus === "abandoned") return "abandoned";
  return invoiceStatus || "approved";
}

// Maps order status + payment method to a flow trigger_type
function mapToFlowTrigger(status: string, paymentMethod: string | null, eventType: string): string | null {
  // Abandoned cart
  if (status === "abandoned" || eventType.includes("abandoned") || eventType.includes("checkout.abandoned")) {
    return "carrinho_abandonado";
  }
  // Declined card
  if (status === "failed" && paymentMethod?.toLowerCase()?.includes("card")) {
    return "cartao";
  }
  if (status === "failed" && paymentMethod?.toLowerCase()?.includes("credit")) {
    return "cartao";
  }
  // Unpaid PIX (expired or pending too long)
  if ((status === "expired" || status === "failed") && paymentMethod?.toLowerCase()?.includes("pix")) {
    return "pix";
  }
  // Approved purchase
  if (status === "approved") {
    return "compra_aprovada";
  }
  // Refund
  if (status === "refunded" || status === "chargeback") {
    return "reembolso";
  }
  // Cancellation
  if (status === "cancelled") {
    return "cancelamento";
  }
  return null;
}

function extractPayload(payload: any) {
  const invoice = payload?.event?.invoice;
  const payer = invoice?.payer;
  const product = payload?.event?.product;
  const eventType = payload?.type || "";

  const externalOrderId = invoice?.id || payload.order_id || payload.id || payload.transaction_id;

  const buyerName = payer
    ? `${payer.firstName || ""} ${payer.lastName || ""}`.trim()
    : payload.buyer?.name || payload.customer?.name || payload.name || "Sem nome";

  const buyerEmail = payer?.email || payload.buyer?.email || payload.customer?.email || payload.email || null;

  const buyerPhone = normalizePhone(
    payer?.phone || payload.buyer?.phone || payload.customer?.phone || payload.phone || ""
  );

  const rawCpf = payer?.document || payer?.cpf
    || payload.buyer?.document || payload.buyer?.cpf
    || payload.customer?.document || payload.customer?.cpf
    || payload.cpf || payload.document || "";
  const buyerCpf = rawCpf ? normalizeCpf(rawCpf) : null;

  const hublaId = payer?.id || payload.buyer?.id || payload.customer?.id || null;
  const hublaProductId = product?.id || payload.product?.id || null;

  const productName = product?.name || payload.product?.name || payload.product_name || payload.offer?.name || "";

  const amount = invoice?.amount?.totalCents != null
    ? invoice.amount.totalCents / 100
    : parseFloat(payload.amount || payload.price || payload.value || "0") / 100;

  const paymentMethod = invoice?.paymentMethod || payload.payment_method || payload.payment?.method || null;

  const status: string = invoice
    ? mapHublaStatus(eventType, invoice.status)
    : String(payload.status || "approved");

  return {
    externalOrderId, buyerName, buyerEmail, buyerPhone, buyerCpf,
    hublaId, hublaProductId, productName, amount, paymentMethod, status,
  };
}

async function resolveOrCreateLead(
  supabase: any,
  phone: string,
  cpf: string | null,
  name: string,
  email: string | null,
  hublaId: string | null
): Promise<string> {
  // Try to find existing lead by phone first, then by CPF
  let existingLead = null;

  if (phone) {
    const { data } = await supabase
      .from("leads")
      .select("id")
      .eq("phone", phone)
      .maybeSingle();
    existingLead = data;
  }

  if (!existingLead && cpf) {
    const { data } = await supabase
      .from("leads")
      .select("id")
      .eq("cpf", cpf)
      .maybeSingle();
    existingLead = data;
  }

  if (existingLead) {
    await supabase
      .from("leads")
      .update({
        name,
        ...(email ? { email } : {}),
        ...(cpf ? { cpf } : {}),
        ...(hublaId ? { hubla_id: hublaId } : {}),
      })
      .eq("id", existingLead.id);
    return existingLead.id;
  }

  const { data: newLead, error } = await supabase
    .from("leads")
    .insert({
      name, email, phone, origin: "hubla",
      ...(cpf ? { cpf } : {}),
      ...(hublaId ? { hubla_id: hublaId } : {}),
    })
    .select("id")
    .single();
  if (error) throw error;
  return newLead.id;
}

async function logWebhook(
  supabase: any,
  externalOrderId: string | undefined,
  eventStatus: string | undefined,
  httpStatus: number,
  responseMessage: string,
  payload: any
) {
  try {
    await supabase.from("webhook_logs").insert({
      external_order_id: externalOrderId || null,
      event_status: eventStatus || null,
      http_status: httpStatus,
      response_message: responseMessage,
      payload,
    });
  } catch (e) {
    console.error("Failed to log webhook:", e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let payload: any;
  let externalOrderId: string | undefined;
  let status: string | undefined;

  try {
    payload = await req.json();

    const extracted = extractPayload(payload);
    externalOrderId = extracted.externalOrderId;
    status = extracted.status;

    if (!externalOrderId) {
      await logWebhook(supabase, externalOrderId, status, 400, "Missing order ID", payload);
      return new Response(
        JSON.stringify({ error: "Missing order ID" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!extracted.buyerPhone) {
      await logWebhook(supabase, externalOrderId, status, 400, "Missing buyer phone", payload);
      return new Response(
        JSON.stringify({ error: "Missing buyer phone" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Idempotency: check if order already exists (handles duplicate order bump webhooks)
    const { data: existingOrder } = await supabase
      .from("orders")
      .select("id, status")
      .eq("external_order_id", externalOrderId)
      .maybeSingle();

    if (existingOrder) {
      if (existingOrder.status !== status) {
        await supabase
          .from("orders")
          .update({ status, webhook_payload: payload })
          .eq("id", existingOrder.id);
      }
      await logWebhook(supabase, externalOrderId, status, 200, "Duplicate webhook ignored, status updated", payload);
      return new Response(
        JSON.stringify({ message: "Order already exists", order_id: existingOrder.id }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Resolve or create lead (unified by phone OR CPF)
    const leadId = await resolveOrCreateLead(
      supabase, extracted.buyerPhone, extracted.buyerCpf,
      extracted.buyerName, extracted.buyerEmail, extracted.hublaId
    );

    // Resolve product
    let productId: string | null = null;
    // Try matching by Hubla product ID (stored as SKU) first
    if (extracted.hublaProductId) {
      const { data: prod } = await supabase
        .from("products")
        .select("id")
        .eq("sku", extracted.hublaProductId)
        .maybeSingle();
      if (prod) productId = prod.id;
    }
    // Fallback: match by checkout_name
    if (!productId && extracted.productName) {
      const { data: prod } = await supabase
        .from("products")
        .select("id")
        .eq("checkout_name", extracted.productName)
        .maybeSingle();
      if (prod) productId = prod.id;
    }

    // Create order
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({
        lead_id: leadId,
        product_id: productId,
        external_order_id: externalOrderId,
        amount: extracted.amount,
        status,
        payment_method: extracted.paymentMethod,
        webhook_payload: payload,
      })
      .select("id")
      .single();

    if (orderError) {
      // Handle race condition: if unique constraint violated, it's a duplicate
      if (orderError.code === "23505") {
        await logWebhook(supabase, externalOrderId, status, 200, "Duplicate webhook (constraint)", payload);
        return new Response(
          JSON.stringify({ message: "Duplicate order ignored" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw orderError;
    }

    // Auto-generate order items from product composition
    if (productId) {
      const { data: composition } = await supabase
        .from("product_items")
        .select("item_id, quantity")
        .eq("product_id", productId);

      if (composition && composition.length > 0) {
        const orderItems = composition.map((pi: any) => ({
          order_id: order.id,
          item_id: pi.item_id,
          quantity: pi.quantity,
        }));
        await supabase.from("order_items").insert(orderItems);
      }
    }

    // ── AUTO-TRACK: Register purchase campaign event ──
    if (status === "approved" && leadId) {
      // Find the latest campaign that sent to this lead
      const { data: latestLog } = await supabase
        .from("message_logs")
        .select("job_id")
        .eq("lead_id", leadId)
        .eq("status", "sent")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestLog?.job_id) {
        const { error: campaignEventError } = await supabase.from("campaign_events").insert({
          campaign_id: latestLog.job_id,
          lead_id: leadId,
          lead_phone: extracted.buyerPhone,
          event_type: "purchase",
          metadata: { valor: extracted.amount, produto: extracted.productName || null },
        });
        if (campaignEventError) console.error("Failed to register purchase event:", campaignEventError);
      }
    }

    // ── AUTO-SEND PIX: When a PIX invoice is created, send checkout link via WhatsApp ──
    const eventType = payload?.type || "";
    const invoiceObj = payload?.event?.invoice;
    const invoiceStatus = invoiceObj?.status;
    const pmLower = (extracted.paymentMethod || "").toLowerCase();
    const isPixPayment = pmLower === "pix" || pmLower.includes("pix");
    const isPixCreated =
      (eventType === "invoice.created" || eventType === "invoice.status_updated") &&
      isPixPayment &&
      (invoiceStatus === "unpaid" || invoiceStatus === "draft" || invoiceStatus === "overdue" || invoiceStatus === "pending");

    console.log(`[PIX-CHECK] type=${eventType} pm=${extracted.paymentMethod} status=${invoiceStatus} isPix=${isPixCreated} leadId=${leadId} phone=${extracted.buyerPhone}`);

    if (isPixCreated && leadId && extracted.buyerPhone) {
      try {
        // Build Hubla PIX checkout URL.
        const sessionUrl: string | undefined = invoiceObj?.paymentSession?.url;
        const subscriptionId: string | undefined = invoiceObj?.subscriptionId;
        const productHublaId = extracted.hublaProductId || invoiceObj?.id;
        let checkoutUrl: string;
        if (sessionUrl && subscriptionId) {
          checkoutUrl = `${sessionUrl.replace(/\/$/, "")}/${subscriptionId}`;
        } else if (sessionUrl) {
          checkoutUrl = sessionUrl;
        } else {
          checkoutUrl = `https://pay.hub.la/${productHublaId}`;
        }
        const firstName = (extracted.buyerName || "").split(/\s+/)[0] || "amigo(a)";
        const valor = extracted.amount.toLocaleString("pt-BR", {
          style: "currency", currency: "BRL",
        });

        // Find the lead's owner and their default WhatsApp account
        const { data: leadOwner } = await supabase
          .from("leads")
          .select("user_id")
          .eq("id", leadId)
          .maybeSingle();

        let accountId: string | undefined;
        let ownerUserId: string | undefined = leadOwner?.user_id;
        if (ownerUserId) {
          const { data: account } = await supabase
            .from("whatsapp_accounts")
            .select("id")
            .eq("user_id", ownerUserId)
            .eq("is_default", true)
            .maybeSingle();
          accountId = account?.id;

          if (!accountId) {
            const { data: anyAccount } = await supabase
              .from("whatsapp_accounts")
              .select("id")
              .eq("user_id", ownerUserId)
              .limit(1)
              .maybeSingle();
            accountId = anyAccount?.id;
          }
        }

        // Lookup per-user event config (custom copy + media + agent)
        let mediaUrl: string | undefined;
        let mediaType: string | undefined;
        let pixMessage: string;
        let eventConfig: any = null;
        if (ownerUserId) {
          const { data: cfg } = await supabase
            .from("event_agent_config")
            .select("active, send_media, media_url, media_type, message_template, agent_id")
            .eq("user_id", ownerUserId)
            .eq("event_type", "pix_generated")
            .maybeSingle();
          eventConfig = cfg;
        }

        // Activate AI for this lead and bind the configured agent (so follow-up replies are handled by the right agent)
        if (eventConfig?.active) {
          const leadUpdate: any = { ai_enabled: true };
          if (eventConfig.agent_id) leadUpdate.ai_agent_id = eventConfig.agent_id;
          await supabase.from("leads").update(leadUpdate).eq("id", leadId);
        }

        const replaceVars = (tpl: string) => tpl
          .replaceAll("{nome}", firstName)
          .replaceAll("{name}", firstName)
          .replaceAll("{link}", checkoutUrl)
          .replaceAll("{valor}", valor)
          .replaceAll("{produto}", extracted.productName || "");

        if (eventConfig && eventConfig.active && eventConfig.message_template) {
          pixMessage = replaceVars(eventConfig.message_template);
          if (eventConfig.send_media && eventConfig.media_url) {
            mediaUrl = eventConfig.media_url;
            mediaType = eventConfig.media_type || "image";
          }
        } else {
          const productLabel = extracted.productName ? ` do *${extracted.productName}*` : "";
          pixMessage =
            `Oi ${firstName}! 👋\n\n` +
            `Seu PIX${productLabel} foi gerado no valor de *${valor}*.\n\n` +
            `Pra finalizar é só pagar por aqui 👇\n${checkoutUrl}\n\n` +
            `Assim que cair a confirmação eu te aviso por aqui! 🚀`;
        }

        const sendRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/whatsapp-cloud-send`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({
            phone: extracted.buyerPhone,
            message: pixMessage,
            lead_id: leadId,
            account_id: accountId,
            media_url: mediaUrl,
            media_type: mediaType,
          }),
        });
        const sendBody = await sendRes.text();
        console.log(`[PIX-SEND] status=${sendRes.status} account=${accountId} media=${mediaUrl ? "yes" : "no"} body=${sendBody.slice(0, 300)}`);
      } catch (pixErr) {
        console.error("Failed to send PIX message (non-fatal):", pixErr);
      }
    }

    // ── AUTO-TRIGGER: Start matching flows based on event type ──
    const triggerType = mapToFlowTrigger(status, extracted.paymentMethod || null, payload?.type || "");
    if (triggerType && leadId) {
      try {
        // Find active flows matching this trigger
        const { data: matchingFlows } = await supabase
          .from("flows")
          .select("id")
          .eq("trigger_type", triggerType)
          .eq("active", true);

        if (matchingFlows && matchingFlows.length > 0) {
          for (const flow of matchingFlows) {
            // Check if there's already a running execution for this lead+flow
            const { data: existingExec } = await supabase
              .from("flow_executions")
              .select("id")
              .eq("flow_id", flow.id)
              .eq("lead_id", leadId)
              .in("status", ["running", "waiting_delay", "waiting_reply", "waiting_no_response"])
              .maybeSingle();

            if (existingExec) continue; // Skip if already running

            // Get the first step of the flow
            const { data: firstStep } = await supabase
              .from("flow_steps")
              .select("id, step_type, delay_minutes")
              .eq("flow_id", flow.id)
              .is("parent_step_id", null)
              .order("step_order")
              .limit(1)
              .maybeSingle();

            if (!firstStep) continue;

            const nextActionAt = firstStep.step_type === "delay"
              ? new Date(Date.now() + (firstStep.delay_minutes || 0) * 60 * 1000).toISOString()
              : new Date().toISOString();

            const execStatus = firstStep.step_type === "delay" ? "waiting_delay" : "waiting_delay";

            await supabase.from("flow_executions").insert({
              flow_id: flow.id,
              lead_id: leadId,
              current_step_id: firstStep.id,
              status: execStatus,
              next_action_at: nextActionAt,
              metadata: {
                trigger: triggerType,
                order_id: order.id,
                product_name: extracted.productName,
                amount: extracted.amount,
              },
            });

            console.log(`Flow ${flow.id} triggered for lead ${leadId} (trigger: ${triggerType})`);
          }

          // Kick the flow processor
          try {
            await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/flow-processor`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
              },
              body: JSON.stringify({ auto: true }),
            });
          } catch (e) {
            console.error("Failed to invoke flow-processor:", e);
          }
        }
      } catch (flowErr) {
        console.error("Flow trigger error (non-fatal):", flowErr);
      }
    }

    await logWebhook(supabase, externalOrderId, status, 201, "Order created", payload);
    return new Response(
      JSON.stringify({ success: true, order_id: order.id, lead_id: leadId, trigger: triggerType }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Webhook error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logWebhook(supabase, externalOrderId, status, 500, errorMessage, payload);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
