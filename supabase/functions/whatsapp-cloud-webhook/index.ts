import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function formatCurrency(v: any): string {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", "."));
  if (!isFinite(n)) return String(v ?? "");
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function buildVars(lead: any, metadata: any): Record<string, string> {
  const md = metadata || {};
  const fullName = (lead?.name || "").trim();
  const firstName = fullName.split(" ")[0] || "";
  const phone = lead?.phone || "";
  const amount = md.amount ?? md.value ?? md.price;
  const product = md.product_name ?? md.product ?? md.produto ?? "";
  const orderId = md.order_id ?? md.orderId ?? md.pedido ?? "";
  const codigo = md.codigo ?? md.code ?? "";
  const email = lead?.email ?? md.email ?? "";
  const vars: Record<string, string> = {
    nome: firstName, name: firstName, primeiro_nome: firstName,
    nome_completo: fullName, full_name: fullName,
    telefone: phone, phone: phone, email: String(email || ""),
    codigo: String(codigo || ""), code: String(codigo || ""),
    produto: String(product || ""), product: String(product || ""), product_name: String(product || ""),
    pedido: String(orderId || ""), order_id: String(orderId || ""),
    valor: amount != null ? formatCurrency(amount) : "",
    preco: amount != null ? formatCurrency(amount) : "",
    amount: amount != null ? formatCurrency(amount) : "",
    price: amount != null ? formatCurrency(amount) : "",
  };
  for (const [k, v] of Object.entries(md)) {
    if (vars[k] === undefined && v != null && typeof v !== "object") vars[k] = String(v);
  }
  return vars;
}

function interpolate(text: string, vars: Record<string, string>): string {
  if (!text) return text;
  return text
    .replace(/\{(\w+)\}/g, (_m, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`))
    .replace(/\{\{(\d+)\}\}/g, () => vars.nome || "");
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("55")) return digits;
  return "55" + digits;
}

// Brazilian mobile numbers can have 11 digits (with 9) or 10 digits (without).
// WhatsApp sometimes returns without the leading 9. Generate both variants.
function brazilianPhoneVariants(phone: string): string[] {
  const digits = phone.replace(/\D/g, "");
  const clean = digits.startsWith("55") ? digits : "55" + digits;
  const variants = [clean];
  // clean = 55 + DDD(2) + number
  const afterCountry = clean.slice(2); // DDD + number
  if (afterCountry.length === 11 && afterCountry[2] === "9") {
    // Has the 9 → also try without it
    variants.push("55" + afterCountry.slice(0, 2) + afterCountry.slice(3));
  } else if (afterCountry.length === 10) {
    // Missing the 9 → also try with it
    variants.push("55" + afterCountry.slice(0, 2) + "9" + afterCountry.slice(2));
  }
  return variants;
}

function normalizeTriggerValue(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

async function resolveMatchedFlowStep(
  supabase: any,
  flowId: string,
  currentStepId: string | null,
  candidateTriggers: string[],
) {
  if (!currentStepId || candidateTriggers.length === 0) {
    return null;
  }

  const { data: currentStep } = await supabase
    .from("flow_steps")
    .select("id, step_type, parent_step_id")
    .eq("id", currentStepId)
    .maybeSingle();

  if (!currentStep) {
    return null;
  }

  let branchSteps: any[] = [];

  if (currentStep.step_type === "condition" && currentStep.parent_step_id) {
    const { data } = await supabase
      .from("flow_steps")
      .select("*")
      .eq("flow_id", flowId)
      .eq("parent_step_id", currentStep.parent_step_id);

    branchSteps = data || [];
  } else {
    const { data } = await supabase
      .from("flow_steps")
      .select("*")
      .eq("flow_id", flowId)
      .eq("parent_step_id", currentStepId);

    branchSteps = data || [];
  }

  return branchSteps.find((step: any) => candidateTriggers.includes(normalizeTriggerValue(step.trigger_value))) || null;
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // ── GET: Webhook verification (Meta challenge) ──
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    // Try to get verify token from database first, then fall back to env var
    let VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN");
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const sb = createClient(supabaseUrl, supabaseKey);
      const { data } = await sb.from("app_settings").select("value").eq("key", "whatsapp_verify_token").maybeSingle();
      if (data?.value) VERIFY_TOKEN = data.value;
    } catch (e) {
      console.error("Failed to read verify token from DB:", e);
    }

    console.log("Webhook verify - mode:", mode, "received token:", JSON.stringify(token), "expected token:", JSON.stringify(VERIFY_TOKEN), "match:", token === VERIFY_TOKEN);

    if (mode === "subscribe" && token && VERIFY_TOKEN && token.trim() === VERIFY_TOKEN.trim()) {
      console.log("Webhook verified successfully");
      return new Response(challenge, { status: 200, headers: corsHeaders });
    }

    console.log("Webhook verification failed. Token mismatch.");
    return new Response("Forbidden", { status: 403, headers: corsHeaders });
  }

  // ── POST: Incoming messages ──
  try {
    // ============ RAW CAPTURE (before any parsing) ============
    const rawHeaders: Record<string, string> = {};
    req.headers.forEach((v, k) => { rawHeaders[k] = v; });
    const rawBody = await req.text();
    console.log("RAW WEBHOOK HEADERS:", JSON.stringify(rawHeaders));
    console.log("RAW WEBHOOK:", rawBody);
    console.log("RAW WEBHOOK LENGTH:", rawBody.length);

    let payload: any = null;
    let parseError: string | null = null;
    try {
      payload = JSON.parse(rawBody);
    } catch (e: any) {
      parseError = e?.message || String(e);
      console.error("[A] JSON PARSE FAILED:", parseError);
    }
    console.log("[A] payload recebido:", JSON.stringify(payload));

    // Persist raw debug always (best-effort)
    try {
      const dbgUrl = Deno.env.get("SUPABASE_URL")!;
      const dbgKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const dbg = createClient(dbgUrl, dbgKey);
      // Pre-classify message types for quick inspection
      const entries = payload?.entry || [];
      const changes = entries.flatMap((e: any) => e?.changes || []);
      const values = changes.map((c: any) => c?.value).filter(Boolean);
      const msgs = values.flatMap((v: any) => v?.messages || []);
      const statuses = values.flatMap((v: any) => v?.statuses || []);
      const msgSummary = msgs.map((m: any) => ({
        type: m?.type,
        id: m?.id,
        from: m?.from,
        interactive_type: m?.interactive?.type,
        button_reply_id: m?.interactive?.button_reply?.id,
        button_reply_title: m?.interactive?.button_reply?.title,
        list_reply_id: m?.interactive?.list_reply?.id,
        list_reply_title: m?.interactive?.list_reply?.title,
        button_payload: m?.button?.payload,
        button_text: m?.button?.text,
        context_id: m?.context?.id,
        text_body: m?.text?.body,
      }));
      console.log("=== MESSAGE SUMMARY ===", JSON.stringify(msgSummary));
      console.log("=== STATUS COUNT ===", statuses.length);

      const phoneNumberId = values[0]?.metadata?.phone_number_id || null;
      const knownTypes = new Set(["text","image","audio","video","document","sticker","interactive","button","location","contacts","reaction","order","system","unsupported"]);
      const unknownTypes = msgs.filter((m: any) => !knownTypes.has(m?.type)).map((m: any) => m?.type);

      await dbg.from("webhook_debug").insert({
        source: "whatsapp-cloud-webhook",
        headers: rawHeaders,
        raw_body: rawBody,
        parsed: payload,
        notes: JSON.stringify({
          parseError,
          phone_number_id: phoneNumberId,
          message_count: msgs.length,
          status_count: statuses.length,
          message_summary: msgSummary,
          unknown_types: unknownTypes,
        }),
      });
    } catch (dbgErr) {
      console.error("Failed to persist webhook_debug:", dbgErr);
    }

    if (!payload) {
      return new Response(
        JSON.stringify({ ok: false, error: "invalid_json", detail: parseError }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("WhatsApp Cloud webhook received:", JSON.stringify(payload));


    // Some Evolution instances can be pointed at this legacy webhook URL.
    // Forward those payloads to the Evolution handler so replies continue flows correctly.
    if (typeof payload?.event === "string" && (payload.instance || payload.instanceName) && payload.data) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const forwardRes = await fetch(`${supabaseUrl}/functions/v1/evolution-webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify(payload),
      });
      const forwardText = await forwardRes.text();
      return new Response(forwardText || JSON.stringify({ ok: forwardRes.ok, forwarded: "evolution" }), {
        status: forwardRes.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const changeValues = (payload.entry || [])
      .flatMap((entry: any) => entry?.changes || [])
      .map((change: any) => change?.value)
      .filter(Boolean);

    const value = changeValues.length <= 1
      ? changeValues[0]
      : {
          ...changeValues[0],
          metadata:
            changeValues.find((item: any) => item?.messages?.length && item?.metadata)?.metadata ||
            changeValues.find((item: any) => item?.metadata)?.metadata ||
            null,
          contacts: changeValues.flatMap((item: any) => item?.contacts || []),
          messages: changeValues.flatMap((item: any) => item?.messages || []),
          statuses: changeValues.flatMap((item: any) => item?.statuses || []),
        };

    if (!value) {
      return new Response(
        JSON.stringify({ ok: true, skipped: "no value" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (changeValues.length > 1) {
      console.log("Merged webhook changes:", JSON.stringify({
        changeCount: changeValues.length,
        messageCount: value.messages?.length || 0,
        statusCount: value.statuses?.length || 0,
      }));
    }

    const hasStatuses = Array.isArray(value.statuses) && value.statuses.length > 0;

    // Handle status updates without skipping message processing when Meta sends both in the same payload
    if (hasStatuses) {
      console.log("Status update received:", JSON.stringify(value.statuses));
      
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const sb = createClient(supabaseUrl, supabaseKey);
      
      for (const statusUpdate of value.statuses) {
        const waMessageId = statusUpdate.id;
        const status = statusUpdate.status; // sent, delivered, read, failed
        const ts = statusUpdate.timestamp 
          ? new Date(parseInt(statusUpdate.timestamp) * 1000).toISOString() 
          : new Date().toISOString();
        
        if (waMessageId) {
          const updates: any = { status };
          if (status === "delivered") updates.delivered_at = ts;
          if (status === "read") { updates.read_at = ts; updates.delivered_at = ts; }

          await sb.from("chat_messages")
            .update(updates)
            .eq("zapi_message_id", waMessageId);

          let logTracking:
            | { job_id: string; lead_id: string | null; phone: string; delivered: boolean; read: boolean }
            | null = null;

          if (status === "delivered") {
            const { data: deliveredLog } = await sb
              .from("message_logs")
              .update({ status: "delivered" })
              .eq("wa_message_id", waMessageId)
              .not("status", "in", '("delivered","read")')
              .select("job_id, lead_id, phone")
              .maybeSingle();

            if (deliveredLog) {
              logTracking = { ...deliveredLog, delivered: true, read: false };
            }
          } else if (status === "read") {
            const { data: readFromSentLog } = await sb
              .from("message_logs")
              .update({ status: "read" })
              .eq("wa_message_id", waMessageId)
              .not("status", "in", '("delivered","read")')
              .select("job_id, lead_id, phone")
              .maybeSingle();

            if (readFromSentLog) {
              logTracking = { ...readFromSentLog, delivered: true, read: true };
            } else {
              const { data: readFromDeliveredLog } = await sb
                .from("message_logs")
                .update({ status: "read" })
                .eq("wa_message_id", waMessageId)
                .eq("status", "delivered")
                .select("job_id, lead_id, phone")
                .maybeSingle();

              if (readFromDeliveredLog) {
                logTracking = { ...readFromDeliveredLog, delivered: false, read: true };
              }
            }
          } else {
            await sb
              .from("message_logs")
              .update({ status })
              .eq("wa_message_id", waMessageId)
              .neq("status", status);
          }

          if (logTracking?.job_id && (logTracking.delivered || logTracking.read)) {
            const { data: jobMetrics } = await sb
              .from("broadcast_jobs")
              .select("delivered_count, read_count")
              .eq("id", logTracking.job_id)
              .maybeSingle();

            if (jobMetrics) {
              await sb
                .from("broadcast_jobs")
                .update({
                  delivered_count: (jobMetrics.delivered_count || 0) + (logTracking.delivered ? 1 : 0),
                  read_count: (jobMetrics.read_count || 0) + (logTracking.read ? 1 : 0),
                  updated_at: new Date().toISOString(),
                })
                .eq("id", logTracking.job_id);
            }

            const eventsToInsert = [] as Array<{
              campaign_id: string;
              lead_id: string | null;
              lead_phone: string;
              event_type: "delivered" | "read";
            }>;

            if (logTracking.delivered) {
              eventsToInsert.push({
                campaign_id: logTracking.job_id,
                lead_id: logTracking.lead_id,
                lead_phone: logTracking.phone,
                event_type: "delivered",
              });
            }

            if (logTracking.read) {
              eventsToInsert.push({
                campaign_id: logTracking.job_id,
                lead_id: logTracking.lead_id,
                lead_phone: logTracking.phone,
                event_type: "read",
              });
            }

            if (eventsToInsert.length > 0) {
              const { error: campaignEventError } = await sb.from("campaign_events").insert(eventsToInsert);
              if (campaignEventError) {
                console.error("Failed to persist campaign events:", campaignEventError);
              }
            }
          }
        }
      }
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // STRICT account resolution by metadata.phone_number_id.
    // No global token fallback. No "first/default account" fallback.
    const incomingPhoneNumberId = value.metadata?.phone_number_id || "";
    console.log("[B] phone_number_id extraído:", incomingPhoneNumberId);
    if (!incomingPhoneNumberId) {
      console.warn("[I] discard_reason: missing_phone_number_id");
      await supabase.from("webhook_debug").insert({
        source: "whatsapp-cloud-webhook",
        notes: JSON.stringify({ discard_reason: "missing_phone_number_id" }),
        parsed: { value },
      }).catch(() => {});
      return new Response(
        JSON.stringify({ ok: true, ignored: "missing_phone_number_id", discard_reason: "missing_phone_number_id" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const { data: matchedAccount } = await supabase
      .from("whatsapp_accounts")
      .select("id, access_token, user_id, business_account_id")
      .eq("phone_number_id", incomingPhoneNumberId)
      .maybeSingle();
    if (!matchedAccount || !matchedAccount.access_token) {
      console.warn("[I] discard_reason: account_not_found phone_number_id=", incomingPhoneNumberId);
      await supabase.from("webhook_debug").insert({
        source: "whatsapp-cloud-webhook",
        notes: JSON.stringify({ discard_reason: "account_not_found", phone_number_id: incomingPhoneNumberId }),
        parsed: { phone_number_id: incomingPhoneNumberId, value },
      }).catch(() => {});
      return new Response(
        JSON.stringify({ ok: true, ignored: "account_not_found", discard_reason: "account_not_found", phone_number_id: incomingPhoneNumberId }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const ACCESS_TOKEN: string = matchedAccount.access_token;
    const resolvedAccountId: string = matchedAccount.id;
    const resolvedUserId: string = matchedAccount.user_id;
    console.log("[C] conta encontrada:", JSON.stringify({ account_id: resolvedAccountId, user_id: resolvedUserId }));

    const messages = value.messages;
    if (!messages || messages.length === 0) {
      console.log("[I] discard_reason: no_messages (status_update only =", hasStatuses, ")");
      return new Response(
        JSON.stringify({ ok: true, type: hasStatuses ? "status_update" : "no_messages" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }




    for (const msg of messages) {
      const rawPhone = msg.from || "";
      const messageId = msg.id || crypto.randomUUID();
      const timestamp = msg.timestamp ? new Date(parseInt(msg.timestamp) * 1000).toISOString() : new Date().toISOString();

      // Get sender name from contacts
      const contact = value.contacts?.find((c: any) => c.wa_id === rawPhone);
      const senderName = contact?.profile?.name || `WhatsApp ${rawPhone}`;

      let text = "";
      let mediaType: string | null = null;
      let mediaUrl: string | null = null;

      // Text
      if (msg.type === "text") {
        text = msg.text?.body || "";
      }

      // Image
      if (msg.type === "image") {
        mediaType = "image";
        text = msg.image?.caption || "";
        if (msg.image?.id && ACCESS_TOKEN) {
          mediaUrl = await downloadCloudMedia(msg.image.id, ACCESS_TOKEN, supabase, messageId, "image");
        }
      }

      // Audio
      if (msg.type === "audio") {
        mediaType = "audio";
        if (msg.audio?.id && ACCESS_TOKEN) {
          mediaUrl = await downloadCloudMedia(msg.audio.id, ACCESS_TOKEN, supabase, messageId, "audio");
        }
      }

      // Video
      if (msg.type === "video") {
        mediaType = "video";
        text = msg.video?.caption || "";
        if (msg.video?.id && ACCESS_TOKEN) {
          mediaUrl = await downloadCloudMedia(msg.video.id, ACCESS_TOKEN, supabase, messageId, "video");
        }
      }

      // Document
      if (msg.type === "document") {
        mediaType = "document";
        text = msg.document?.caption || msg.document?.filename || "";
        if (msg.document?.id && ACCESS_TOKEN) {
          mediaUrl = await downloadCloudMedia(msg.document.id, ACCESS_TOKEN, supabase, messageId, "document");
        }
      }

      // Sticker
      if (msg.type === "sticker") {
        mediaType = "image";
        if (msg.sticker?.id && ACCESS_TOKEN) {
          mediaUrl = await downloadCloudMedia(msg.sticker.id, ACCESS_TOKEN, supabase, messageId, "image");
        }
      }

      // Interactive button reply
      let buttonPayload: string | null = null;
      let buttonTitle: string | null = null;
      if (msg.type === "interactive") {
        const reply = msg.interactive?.button_reply || msg.interactive?.list_reply;
        if (reply) {
          text = reply.title || reply.id || "";
          buttonPayload = reply.id || reply.title || "";
          buttonTitle = reply.title || null;
          console.log("Button reply received - id:", buttonPayload, "title:", buttonTitle);
        }
      }
      // Quick reply (from template buttons)
      if (msg.type === "button") {
        text = msg.button?.text || "";
        buttonPayload = msg.button?.payload || msg.button?.text || "";
        buttonTitle = msg.button?.text || null;
        console.log("Quick reply received:", buttonPayload);
      }

      if (!text && !mediaUrl) continue;

      const cleanPhone = normalizePhone(rawPhone);
      const phoneVariants = brazilianPhoneVariants(rawPhone);
      const phoneFilter = phoneVariants.map(p => `phone.eq.${p}`).join(",");

      const activityAt = new Date().toISOString();

      // Find or create lead (scoped by user_id for multi-tenant isolation)
      let leadQuery = supabase
        .from("leads")
        .select("id, name, phone")
        .or(phoneFilter);
      
      if (resolvedUserId) {
        leadQuery = leadQuery.eq("user_id", resolvedUserId);
      }

      let { data: lead } = await leadQuery.limit(1).maybeSingle();

      if (!lead) {
        const { data: newLead, error: createError } = await supabase
          .from("leads")
          .insert({
            name: senderName,
            phone: cleanPhone,
            origin: "whatsapp-cloud",
            last_inbound_at: activityAt,
            updated_at: activityAt,
            user_id: resolvedUserId,
          })
          .select("id, name, phone")
          .single();
        if (createError) throw createError;
        lead = newLead;
      } else {
        const leadUpdates: Record<string, string> = {
          last_inbound_at: activityAt,
          updated_at: activityAt,
        };

        if (senderName && lead.name.startsWith("WhatsApp ")) {
          leadUpdates.name = senderName;
        }

        const { error: leadUpdateError } = await supabase
          .from("leads")
          .update(leadUpdates)
          .eq("id", lead.id);

        if (leadUpdateError) throw leadUpdateError;
      }

      // Save message — include button info for visibility
      let contentText = text || (mediaType === "audio" ? "🎤 Áudio" : mediaType === "image" ? "📷 Imagem" : mediaType === "video" ? "🎥 Vídeo" : "📎 Arquivo");
      
      // If it's a button reply, prefix with emoji for clarity
      if (buttonPayload && !contentText.startsWith("🔘")) {
        contentText = `🔘 ${contentText}`;
      }

      await supabase.from("chat_messages").insert({
        lead_id: lead!.id,
        direction: "inbound",
        content: contentText,
        media_type: mediaType,
        media_url: mediaUrl,
        zapi_message_id: messageId,
        status: "received",
        account_id: resolvedAccountId,
      });

      // ── AI AUTO-REPLY: Trigger AI response if enabled ──
      // Only for text messages (not button replies which are handled by flows)
      if (!buttonPayload && text) {
        try {
          const aiRes = await fetch(`${supabaseUrl}/functions/v1/ai-auto-reply`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify({
              lead_id: lead!.id,
              message: text,
              account_id: resolvedAccountId,
            }),
          });
          if (!aiRes.ok) {
            console.error("AI auto-reply call failed:", aiRes.status);
          } else {
            const aiResult = await aiRes.json();
            console.log("AI auto-reply result:", JSON.stringify(aiResult));
          }
        } catch (aiErr) {
          console.error("AI auto-reply error:", aiErr);
        }
      }

      // ── AUTO-TRACK: Register reply/click campaign events ──
      if (lead) {
        // Find the latest campaign that sent to this lead (by lead_id OR phone)
        let latestLog: any = null;

        // Try by lead_id first
        const { data: logById } = await supabase
          .from("message_logs")
          .select("job_id, lead_id, phone")
          .eq("lead_id", lead.id)
          .eq("status", "sent")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        latestLog = logById;

        // Fallback: search by phone variants
        if (!latestLog) {
          for (const variant of phoneVariants) {
            const { data: logByPhone } = await supabase
              .from("message_logs")
              .select("job_id, lead_id, phone")
              .eq("phone", variant)
              .eq("status", "sent")
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (logByPhone) { latestLog = logByPhone; break; }
          }
        }

        if (latestLog?.job_id) {
          const eventType = buttonPayload ? "click" : "reply";
          console.log(`Tracking campaign event: type=${eventType}, campaign=${latestLog.job_id}, lead=${lead.id}, button=${buttonPayload}`);
          const { error: trackErr } = await supabase.from("campaign_events").insert({
            campaign_id: latestLog.job_id,
            lead_id: lead.id,
            lead_phone: cleanPhone,
            event_type: eventType,
            metadata: buttonPayload ? { button: buttonPayload } : {},
          });
          if (trackErr) console.error("Failed to track campaign event:", trackErr);
        } else {
          console.log("No campaign found for lead:", lead.id, "phone variants:", phoneVariants);
        }
      }

      // Check for flow executions waiting for user reply
      if ((buttonPayload || text) && lead) {
        const { data: executions } = await supabase
          .from("flow_executions")
          .select("id, current_step_id, flow_id, metadata")
          .eq("lead_id", lead.id)
          .eq("status", "waiting_reply");

        for (const exec of executions || []) {
          const currentStepId = exec.current_step_id;
          const candidateTriggers = Array.from(new Set([
            normalizeTriggerValue(buttonPayload),
            normalizeTriggerValue(buttonTitle),
            normalizeTriggerValue(text),
          ].filter(Boolean)));

          let matchedStep: any = await resolveMatchedFlowStep(
            supabase,
            exec.flow_id,
            currentStepId,
            candidateTriggers,
          );

          // Fallback: old linear approach (condition node by trigger_value)
          if (!matchedStep) {
            const { data: conditionSteps } = await supabase
              .from("flow_steps")
              .select("*")
              .eq("flow_id", exec.flow_id)
              .eq("step_type", "condition");

            const conditionStep = (conditionSteps || []).find((s: any) =>
              candidateTriggers.includes(normalizeTriggerValue(s.trigger_value))
            );

            if (conditionStep) {
              // Find child of this condition step
              const { data: condChildren } = await supabase
                .from("flow_steps")
                .select("*")
                .eq("flow_id", exec.flow_id)
                .eq("parent_step_id", conditionStep.id)
                .order("step_order")
                .limit(1);

              if (condChildren && condChildren.length > 0) {
                matchedStep = condChildren[0];
              } else {
                // Fallback: next by step_order
                const { data: followingSteps } = await supabase
                  .from("flow_steps")
                  .select("*")
                  .eq("flow_id", exec.flow_id)
                  .gt("step_order", conditionStep.step_order)
                  .order("step_order")
                  .limit(1);

                if (followingSteps && followingSteps.length > 0) {
                  matchedStep = followingSteps[0];
                }
              }
            }
          }

          console.log("Flow reply resolution:", JSON.stringify({
            executionId: exec.id,
            currentStepId,
            candidateTriggers,
            matchedStepId: matchedStep?.id || null,
            matchedStepType: matchedStep?.step_type || null,
          }));

          if (matchedStep) {
            if (matchedStep.step_type === "condition") {
              const { data: condChildren } = await supabase
                .from("flow_steps")
                .select("*")
                .eq("flow_id", exec.flow_id)
                .eq("parent_step_id", matchedStep.id)
                .order("step_order")
                .limit(1);

              if (condChildren && condChildren.length > 0) {
                await processFlowStep(condChildren[0], exec, lead, supabase, resolvedAccountId);
              } else {
                console.log("Condition matched but has no child step:", matchedStep.id, "exec:", exec.id);
                await supabase.from("flow_executions").update({
                  status: "completed",
                  updated_at: new Date().toISOString(),
                }).eq("id", exec.id);
              }
            } else {
              await processFlowStep(matchedStep, exec, lead, supabase, resolvedAccountId);
            }
          } else {
            console.log("No matching branch for button payload:", buttonPayload, "exec:", exec.id);
            await supabase.from("flow_executions").update({
              status: "waiting_reply",
              updated_at: new Date().toISOString(),
            }).eq("id", exec.id);
          }
        }
      }
    }
    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("WhatsApp Cloud webhook error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function downloadCloudMedia(
  mediaId: string,
  accessToken: string,
  supabase: any,
  messageId: string,
  type: string
): Promise<string | null> {
  try {
    // Step 1: Get media URL from Meta
    const metaRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!metaRes.ok) {
      console.error("Failed to get media URL:", metaRes.status);
      await metaRes.text();
      return null;
    }
    const metaData = await metaRes.json();
    const downloadUrl = metaData.url;

    if (!downloadUrl) return null;

    // Step 2: Download media
    const mediaRes = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!mediaRes.ok) {
      console.error("Failed to download media:", mediaRes.status);
      await mediaRes.text();
      return null;
    }
    const blob = await mediaRes.blob();

    const ext = type === "image" ? "jpg" : type === "audio" ? "ogg" : type === "video" ? "mp4" : "bin";
    const path = `incoming/${messageId}.${ext}`;

    const { error } = await supabase.storage
      .from("chat-media")
      .upload(path, blob, { contentType: blob.type, upsert: true });

    if (error) {
      console.error("Failed to upload media:", error);
      return null;
    }

    const { data: publicUrl } = supabase.storage.from("chat-media").getPublicUrl(path);
    return publicUrl.publicUrl;
  } catch (e) {
    console.error("Error downloading cloud media:", e);
    return null;
  }
}

async function processFlowStep(step: any, execution: any, lead: any, supabase: any, fallbackAccountId?: string | null) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const accountId = typeof execution.metadata?.account_id === "string" && execution.metadata.account_id
    ? execution.metadata.account_id
    : fallbackAccountId || null;

  if (accountId && execution.metadata?.account_id !== accountId) {
    execution.metadata = { ...(execution.metadata || {}), account_id: accountId };
    await supabase.from("flow_executions").update({
      metadata: execution.metadata,
      updated_at: new Date().toISOString(),
    }).eq("id", execution.id);
  }

  if (step.step_type === "message" || step.step_type === "cta_url" || step.step_type === "interactive_buttons") {
    const body: any = { phone: lead.phone || lead.name, lead_id: lead.id };
    if (accountId) body.account_id = accountId;

    const vars = buildVars(lead, execution.metadata);
    const firstName = vars.nome;

    if (step.step_type === "cta_url") {
      const buttons = Array.isArray(step.buttons) ? step.buttons : [];
      const ctaBtn = buttons[0];
      body.message = interpolate(step.custom_message || "Acesse o link abaixo:", vars);
      if (ctaBtn?.url) {
        body.cta_url = { display_text: ctaBtn.title || "Acessar", url: ctaBtn.url };
      }
    } else if (step.step_type === "interactive_buttons") {
      const buttons = Array.isArray(step.buttons) ? step.buttons : [];
      body.message = interpolate(step.custom_message || "Escolha uma opção:", vars);
      body.interactive_buttons = buttons;
    } else if (step.template_id) {
      const { data: template } = await supabase
        .from("chat_templates")
        .select("*")
        .eq("id", step.template_id)
        .single();

      if (template?.template_name) {
        body.template_name = template.template_name;
        body.template_language = template.template_language || "pt_BR";
        const rawParams = (template.template_params || []) as any[];
        body.template_params = rawParams.map((p: any) => {
          const text = typeof p === "string" ? p : p?.text || "";
          const resolved = interpolate(text, vars);
          return { type: "text", text: resolved || firstName };
        });
      } else if (template) {
        body.message = template.content;
      }
    } else if (step.custom_message) {
      body.message = interpolate(step.custom_message, vars);
    }

    // Only send if there's something to send
    if (!body.message && !body.template_name && !body.interactive_buttons && !body.cta_url) {
      console.error("processFlowStep: nothing to send for step:", step.id);
      return;
    }

    console.log("processFlowStep sending:", step.id, JSON.stringify(body));

    const sendRes = await fetch(`${supabaseUrl}/functions/v1/whatsapp-cloud-send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!sendRes.ok) {
      const errText = await sendRes.text();
      console.error("processFlowStep send failed:", sendRes.status, errText);
      return;
    }
    await sendRes.text();

    // Advance to next step
    await advanceExecution(execution, step, lead, supabase);
  } else if (step.step_type === "delay") {
    await supabase.from("flow_executions").update({
      current_step_id: step.id,
      status: "waiting_delay",
      next_action_at: new Date(Date.now() + step.delay_minutes * 60 * 1000).toISOString(),
    }).eq("id", execution.id);
    // Trigger flow-processor to handle the delay
    await triggerFlowProcessor(supabaseUrl, supabaseKey);
  } else if (step.step_type === "no_response") {
    const timeoutMin = step.timeout_minutes || 10;
    await supabase.from("flow_executions").update({
      current_step_id: step.id,
      status: "waiting_no_response",
      next_action_at: new Date(Date.now() + timeoutMin * 60 * 1000).toISOString(),
    }).eq("id", execution.id);
    await triggerFlowProcessor(supabaseUrl, supabaseKey);
  } else if (step.step_type === "condition") {
    await supabase.from("flow_executions").update({
      current_step_id: step.id,
      status: "waiting_reply",
    }).eq("id", execution.id);
  }
}

async function advanceExecution(execution: any, currentStep: any, lead: any, supabase: any) {
  // BRANCHING: find children by parent_step_id first
  const { data: childSteps } = await supabase
    .from("flow_steps")
    .select("*")
    .eq("flow_id", execution.flow_id)
    .eq("parent_step_id", currentStep.id)
    .order("step_order");

  if (childSteps && childSteps.length > 0) {
    if (childSteps.length === 1) {
      await processFlowStep(childSteps[0], execution, lead, supabase, execution.metadata?.account_id || null);
      return;
    }
    const hasConditionalBranches = childSteps.some((step: any) => step.step_type === "condition");
    // Multiple children with conditions = wait for reply on the parent step
    if (currentStep.step_type === "interactive_buttons" || hasConditionalBranches) {
      await supabase.from("flow_executions").update({
        current_step_id: currentStep.id,
        status: "waiting_reply",
      }).eq("id", execution.id);
      return;
    }
    // Default: take first child
    await processFlowStep(childSteps[0], execution, lead, supabase, execution.metadata?.account_id || null);
    return;
  }

  // Fallback: linear ordering
  const { data: nextSteps } = await supabase
    .from("flow_steps")
    .select("*")
    .eq("flow_id", execution.flow_id)
    .gt("step_order", currentStep.step_order)
    .is("parent_step_id", null)
    .order("step_order")
    .limit(1);

  if (!nextSteps || nextSteps.length === 0) {
    await supabase.from("flow_executions").update({ status: "completed" }).eq("id", execution.id);
    return;
  }

  await processFlowStep(nextSteps[0], execution, lead, supabase, execution.metadata?.account_id || null);
}

async function triggerFlowProcessor(supabaseUrl: string, supabaseKey: string) {
  try {
    await fetch(`${supabaseUrl}/functions/v1/flow-processor`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({ auto: true }),
    });
  } catch (e) {
    console.error("Failed to trigger flow-processor:", e);
  }
}
