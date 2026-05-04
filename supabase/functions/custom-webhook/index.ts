import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ─────────────────────────────────────────────
// Lead extraction — supports Assiny / Hubla / Perfect Pay / generic shapes
// ─────────────────────────────────────────────
function pickFirst(...vals: any[]): string | null {
  for (const v of vals) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

function normalizePhone(raw: string | null): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  return digits || null;
}

function extractLead(payload: any): { phone: string | null; name: string | null; email: string | null; cpf: string | null; orderId: string | null; amount: number | null; productName: string | null; } {
  const p = payload || {};
  const data = p.data || {};
  const client = data.client || {};
  const user = data.user || p.user || {};
  const customer = p.customer || data.customer || {};
  const buyer = p.buyer || data.buyer || {};
  const event = p.event || {};
  const invoice = event.invoice || data.invoice || {};
  const tx = data.transaction || p.transaction || {};
  const offer = data.offer || {};
  const product = offer.product || data.product || p.product || {};

  const phone = normalizePhone(pickFirst(
    client.phone, user.phone, customer.phone, buyer.phone,
    invoice?.customer?.phone, p.phone,
  ));

  const name = pickFirst(
    client.full_name,
    [client.first_name, client.last_name].filter(Boolean).join(" ").trim() || null,
    user.firstName ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() : null,
    customer.name, buyer.name, invoice?.customer?.name, p.name,
  );

  const email = pickFirst(client.email, user.email, customer.email, buyer.email, invoice?.customer?.email, p.email);
  const cpf = pickFirst(client.document, user.document, customer.document, buyer.document, p.cpf);
  const orderId = pickFirst(tx.id, p.order_id, data.order_id, invoice?.id, p.id);
  const amountCents = Number(tx.amount ?? offer.amount ?? 0);
  const amount = amountCents > 0 ? amountCents / 100 : null;
  const productName = pickFirst(product.name, offer.name, p.product_name);

  return { phone, name, email, cpf, orderId, amount, productName };
}

async function resolveOrCreateLead(
  admin: any,
  userId: string,
  info: ReturnType<typeof extractLead>,
): Promise<string | null> {
  if (!info.phone) return null;

  // Try existing lead by phone within this tenant
  const { data: existing } = await admin
    .from("leads")
    .select("id")
    .eq("user_id", userId)
    .eq("phone", info.phone)
    .maybeSingle();

  if (existing?.id) {
    // Update name/email/cpf if missing
    const patch: any = {};
    if (info.name) patch.name = info.name;
    if (info.email) patch.email = info.email;
    if (info.cpf) patch.cpf = info.cpf;
    if (Object.keys(patch).length > 0) {
      await admin.from("leads").update(patch).eq("id", existing.id);
    }
    return existing.id;
  }

  const { data: created, error: insErr } = await admin
    .from("leads")
    .insert({
      user_id: userId,
      phone: info.phone,
      name: info.name || info.phone,
      email: info.email,
      cpf: info.cpf,
      origin: "custom_webhook",
      chat_status: "novos_pedidos",
    })
    .select("id")
    .maybeSingle();

  if (insErr) {
    console.error("Failed to create lead:", insErr);
    return null;
  }
  return created?.id ?? null;
}

async function triggerMatchingFlows(
  admin: any,
  supabaseUrl: string,
  serviceRoleKey: string,
  userId: string,
  triggerType: string,
  leadId: string,
  meta: Record<string, unknown>,
) {
  const { data: matchingFlows } = await admin
    .from("flows")
    .select("id")
    .eq("user_id", userId)
    .eq("trigger_type", triggerType)
    .eq("active", true);

  if (!matchingFlows || matchingFlows.length === 0) return 0;

  const orderId = (meta?.order_id as string | undefined) || null;
  const dedupeWindowStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  let started = 0;
  for (const flow of matchingFlows) {
    // 1) Skip if there's already an in-flight execution for this lead+flow
    const { data: inFlight } = await admin
      .from("flow_executions")
      .select("id")
      .eq("flow_id", flow.id)
      .eq("lead_id", leadId)
      .in("status", ["running", "waiting_reply", "scheduled", "waiting_delay", "waiting_no_response"])
      .maybeSingle();
    if (inFlight) {
      console.log(`Skip flow ${flow.id} for lead ${leadId}: already in-flight (${inFlight.id})`);
      continue;
    }

    // 2) Skip if same order_id was already processed in last 24h (provider retry)
    if (orderId) {
      const { data: dupOrder } = await admin
        .from("flow_executions")
        .select("id")
        .eq("flow_id", flow.id)
        .eq("lead_id", leadId)
        .eq("metadata->>order_id", orderId)
        .gte("started_at", dedupeWindowStart)
        .limit(1)
        .maybeSingle();
      if (dupOrder) {
        console.log(`Skip flow ${flow.id} for lead ${leadId}: order ${orderId} already processed (${dupOrder.id})`);
        continue;
      }
    }

    // Apenas raízes conectadas ao trigger (parent NULL = ramo conectado durante o save).
    // Nós soltos no canvas ficam salvos mas não disparam.
    const { data: firstStep } = await admin
      .from("flow_steps")
      .select("id")
      .eq("flow_id", flow.id)
      .is("parent_step_id", null)
      .order("step_order", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!firstStep) {
      console.log(`Flow ${flow.id} has no connected root step; skipping.`);
      continue;
    }

    await admin.from("flow_executions").insert({
      flow_id: flow.id,
      lead_id: leadId,
      status: "running",
      current_step_id: firstStep.id,
      next_action_at: new Date().toISOString(),
      metadata: { trigger: triggerType, ...meta },
    });
    started++;
    console.log(`Flow ${flow.id} triggered for lead ${leadId} (${triggerType}, order=${orderId ?? "-"})`);
  }

  if (started > 0) {
    try {
      await fetch(`${supabaseUrl}/functions/v1/flow-processor`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({}),
      });
    } catch (e) {
      console.error("Failed to invoke flow-processor:", e);
    }
  }
  return started;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const token = pathParts[pathParts.length - 1];

    if (!token || token === "custom-webhook") {
      return new Response(JSON.stringify({ error: "Token de webhook não fornecido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: endpoint, error: endpointError } = await adminClient
      .from("webhook_endpoints")
      .select("*")
      .eq("webhook_token", token)
      .eq("is_active", true)
      .maybeSingle();

    if (endpointError || !endpoint) {
      console.error("Webhook endpoint not found or inactive:", token);
      return new Response(JSON.stringify({ error: "Webhook não encontrado ou inativo" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let payload: Record<string, unknown> = {};
    try {
      if (req.method === "POST") payload = await req.json();
    } catch {
      try {
        const text = await req.text();
        payload = { raw: text };
      } catch {
        payload = {};
      }
    }

    const isTest = (payload as any)?._test === true;

    // Persist raw event
    const { data: storedEvent, error: insertError } = await adminClient
      .from("webhook_events")
      .insert({
        endpoint_id: endpoint.id,
        user_id: endpoint.user_id,
        event_type: endpoint.event_type,
        payload,
        is_test: isTest,
      })
      .select("id")
      .maybeSingle();

    if (insertError) {
      console.error("Failed to store webhook event:", insertError);
      return new Response(JSON.stringify({ error: "Falha ao registrar evento" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Skip lead/flow side-effects on test pings
    if (isTest) {
      if (storedEvent?.id) {
        await adminClient.from("webhook_events").update({ processed: true }).eq("id", storedEvent.id);
      }
      return new Response(JSON.stringify({ success: true, event_type: endpoint.event_type, test: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Extract lead info, upsert lead, trigger flow
    const info = extractLead(payload);
    let leadId: string | null = null;
    let flowsStarted = 0;
    try {
      leadId = await resolveOrCreateLead(adminClient, endpoint.user_id, info);
      if (leadId) {
        flowsStarted = await triggerMatchingFlows(
          adminClient,
          supabaseUrl,
          serviceRoleKey,
          endpoint.user_id,
          endpoint.event_type,
          leadId,
          {
            order_id: info.orderId,
            amount: info.amount,
            product_name: info.productName,
            source: "custom_webhook",
            // Lock outbound delivery to the WhatsApp account bound to this webhook
            account_id: (endpoint as any).account_id || undefined,
          },
        );
      } else {
        console.warn(`No phone in payload for endpoint ${endpoint.id}; flow not triggered.`);
      }
    } catch (e) {
      console.error("Lead/flow side-effects failed:", e);
    }

    if (storedEvent?.id) {
      await adminClient.from("webhook_events").update({ processed: true }).eq("id", storedEvent.id);
    }

    console.log(
      `Webhook event processed: type=${endpoint.event_type} user=${endpoint.user_id} lead=${leadId ?? "-"} flows=${flowsStarted}`,
    );

    return new Response(
      JSON.stringify({
        success: true,
        event_type: endpoint.event_type,
        lead_id: leadId,
        flows_started: flowsStarted,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Custom webhook error:", error);
    return new Response(JSON.stringify({ error: "Erro interno no webhook" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
