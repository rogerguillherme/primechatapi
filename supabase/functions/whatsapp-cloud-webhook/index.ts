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

function expandStepTriggerValues(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,\n;|]/)
    .map((v) => normalizeTriggerValue(v))
    .filter(Boolean);
}

function stepMatchesTriggers(step: any, triggers: string[]): boolean {
  const stepTriggers = expandStepTriggerValues(step?.trigger_value);
  if (stepTriggers.length === 0) return false;
  return stepTriggers.some((t) => triggers.includes(t));
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

  let anchorStep = currentStep;
  if (currentStep.step_type === "no_response" && currentStep.parent_step_id) {
    const { data: parentStep } = await supabase
      .from("flow_steps")
      .select("id, step_type, parent_step_id")
      .eq("id", currentStep.parent_step_id)
      .maybeSingle();
    if (parentStep) anchorStep = parentStep;
  }

  let branchSteps: any[] = [];

  const { data } = await supabase
    .from("flow_steps")
    .select("*")
    .eq("flow_id", flowId)
    .eq("parent_step_id", anchorStep.id);

  branchSteps = data || [];

  // If the current step IS a condition and we found no children, 
  // it might be that the user is replying TO a condition step that is waiting.
  if (branchSteps.length === 0 && anchorStep.step_type === "condition") {
    // In some cases, we might want to check siblings if the flow structure is "flat" 
    // but here we follow the parent_step_id chain.
  }

  const matched = branchSteps.find((step: any) => stepMatchesTriggers(step, candidateTriggers));
  if (matched) return matched;

  // Fallback: if we are at a condition step and it has exactly one child (that is NOT another condition),
  // treat it as the next step to execute if no specific trigger matches.
  if (anchorStep.step_type === "condition" && branchSteps.length === 1 && branchSteps[0].step_type !== "condition") {
    return branchSteps[0];
  }

  // Fallback: if there are multiple children and one has NO trigger_value, it's the default branch
  const defaultBranch = branchSteps.find(s => !s.trigger_value || s.trigger_value.trim() === "");
  if (defaultBranch) return defaultBranch;

  return null;
}

// Classifies Meta Cloud API error codes for the WABA protection system.
// severity: "critical" → pause everything; "warning" → log + alert; "info" → just log.
function classifyMetaError(code: string | null): { severity: "critical" | "warning" | "info"; reason: string } {
  if (!code) return { severity: "info", reason: "unknown" };
  switch (code) {
    case "131031": // Business Account locked
    case "368":    // Temporarily blocked for policy violations
      return { severity: "critical", reason: "waba_locked" };
    // Códigos POR DESTINATÁRIO — não pausam a conta/campanha, apenas pulam o contato.
    case "131056": // Pair rate limit (par remetente/destinatário)
    case "130472": // User experiments / destinatário fora do experimento
    case "131048": // Spam rate limit
    case "131049": // Limite de marketing por usuário
      return { severity: "warning", reason: "spam_restriction" };
    case "131026": // Message undeliverable (recipient hasn't opted in)
    case "131047": // Re-engagement message (24h window)
      return { severity: "warning", reason: "quality_yellow" };
    case "130429": // Rate limit
    case "80007":  // Rate limit
      return { severity: "warning", reason: "rate_limit" };
    case "131045": // Template paused/disabled
      return { severity: "warning", reason: "integrity_restriction" };
    default:
      if (code.startsWith("132")) return { severity: "warning", reason: "integrity_restriction" };
      return { severity: "info", reason: "unknown" };
  }
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
    const payload = await req.json();
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

      // Pre-resolve account/user from phone_number_id (needed for protection trigger)
      const _incomingPNId = value.metadata?.phone_number_id || "";
      let resolvedAccountId: string | null = null;
      let resolvedUserId: string | null = null;
      if (_incomingPNId) {
        const { data: acc } = await sb
          .from("whatsapp_accounts")
          .select("id, user_id")
          .eq("phone_number_id", _incomingPNId)
          .maybeSingle();
        if (acc) { resolvedAccountId = acc.id; resolvedUserId = acc.user_id; }
      }


      
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
          if (status === "failed") {
            // Persiste o motivo da Meta também em chat_messages: envios de fluxo
            // não criam linha em message_logs, então sem isso o motivo se perde.
            const fErr = Array.isArray(statusUpdate.errors) ? statusUpdate.errors[0] : null;
            updates.error_code = fErr?.code != null ? String(fErr.code) : null;
            updates.error_title = fErr?.title || fErr?.message || null;
            updates.error_details = fErr?.error_data?.details || fErr?.message || null;
          }

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
          } else if (status === "failed") {
            const err = Array.isArray(statusUpdate.errors) ? statusUpdate.errors[0] : null;
            const errCode = err?.code != null ? String(err.code) : null;
            const errTitle = err?.title || err?.message || null;
            const errDetails = err?.error_data?.details || err?.message || null;
            const classification = classifyMetaError(errCode);

            const finalStatus = classification.severity === "critical" ? "blocked_by_meta" : "failed";

            const { data: failedLog } = await sb
              .from("message_logs")
              .update({
                status: finalStatus,
                meta_error_code: errCode,
                meta_error_title: errTitle,
                meta_error_details: errDetails,
                block_severity: classification.severity,
                failed_at: ts,
              })
              .eq("wa_message_id", waMessageId)
              .not("status", "in", '("delivered","read","blocked_by_meta","failed")')
              .select("job_id, account_id, user_id")
              .maybeSingle();

            if (failedLog?.job_id) {
              const { data: jobNow } = await sb
                .from("broadcast_jobs")
                .select("error_count")
                .eq("id", failedLog.job_id)
                .maybeSingle();
              if (jobNow) {
                await sb.from("broadcast_jobs").update({
                  error_count: (jobNow.error_count || 0) + 1,
                  updated_at: new Date().toISOString(),
                }).eq("id", failedLog.job_id);
              }
            }

            // Trigger protection for critical/quality errors
            if (classification.severity !== "info" && (failedLog?.account_id || resolvedAccountId)) {
              try {
                await fetch(`${supabaseUrl}/functions/v1/waba-protect-account`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${supabaseKey}`,
                  },
                  body: JSON.stringify({
                    account_id: failedLog?.account_id || resolvedAccountId,
                    user_id: failedLog?.user_id || resolvedUserId,
                    reason: classification.reason,
                    meta_error_code: errCode,
                    meta_error_title: errTitle,
                    meta_error_details: errDetails,
                    severity: classification.severity,
                  }),
                });
              } catch (protectErr) {
                console.error("Failed to invoke waba-protect-account:", protectErr);
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

    // Resolve access token: try matching account by phone_number_id, then default, then env var
    const incomingPhoneNumberId = value.metadata?.phone_number_id || "";
    let ACCESS_TOKEN: string | undefined;
    let resolvedAccountId: string | null = null;
    let resolvedUserId: string | null = null;
    if (incomingPhoneNumberId) {
      const { data: matchedAccount } = await supabase
        .from("whatsapp_accounts")
        .select("id, access_token, user_id")
        .eq("phone_number_id", incomingPhoneNumberId)
        .maybeSingle();
      if (matchedAccount) {
        ACCESS_TOKEN = matchedAccount.access_token;
        resolvedAccountId = matchedAccount.id;
        resolvedUserId = matchedAccount.user_id;
      }
    }
    if (!ACCESS_TOKEN) {
      const { data: defaultAccount } = await supabase
        .from("whatsapp_accounts")
        .select("access_token")
        .eq("is_default", true)
        .maybeSingle();
      if (defaultAccount) ACCESS_TOKEN = defaultAccount.access_token;
    }
    if (!ACCESS_TOKEN) {
      ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
    }

    const messages = value.messages;
    if (!messages || messages.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, type: hasStatuses ? "status_update" : "no_messages" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }




    for (const msg of messages) {
      const rawPhone = msg.from || "";
      const messageId = msg.id || crypto.randomUUID();
      const timestamp = msg.timestamp ? new Date(parseInt(msg.timestamp) * 1000).toISOString() : new Date().toISOString();

      // ── IDEMPOTENCY GUARD ──
      // Meta retries webhook deliveries; without this the same message/button click
      // was processed several times, advancing the flow repeatedly and sending duplicates.
      if (msg.id) {
        const { error: dedupError } = await supabase
          .from("whatsapp_inbound_dedup")
          .insert({ message_id: msg.id });
        if (dedupError) {
          if (dedupError.code === "23505") {
            console.log("Duplicate inbound webhook ignored:", msg.id);
            continue;
          }
          console.error("Dedup insert error (processing anyway):", dedupError);
        }
      }


      console.log("WhatsApp inbound message summary:", JSON.stringify({
        messageId,
        type: msg.type,
        from: rawPhone,
        phoneNumberId: incomingPhoneNumberId || null,
        accountId: resolvedAccountId,
        userId: resolvedUserId,
        interactiveType: msg.interactive?.type || null,
        interactiveButtonId: msg.interactive?.button_reply?.id || msg.interactive?.list_reply?.id || null,
        interactiveButtonTitle: msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || null,
        quickReplyPayload: msg.button?.payload || null,
        quickReplyText: msg.button?.text || null,
      }));

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

      // ── AUTO UNSUBSCRIBE ENGINE ──
      // Detect opt-out keywords in inbound text. If matched: blacklist the lead,
      // cancel active flow executions, remove from pending broadcasts and optionally
      // reply with a confirmation. We then SKIP AI auto-reply and tracking below.
      let unsubscribedThisMessage = false;
      if (text && lead && resolvedUserId) {
        try {
          const normalized = text
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .trim();
          // Whole-word / phrase match. \b not reliable across accents, so use lookarounds.
          const UNSUB_REGEX = /(^|[^a-z0-9])(sair|parar|pare|stop|unsubscribe|cancelar|cancela|remover|remove|descadastrar|descadastra|nao quero mais|nao quero|cancelar inscricao|sair da lista|remover da lista)([^a-z0-9]|$)/i;
          const match = normalized.match(UNSUB_REGEX);
          if (match) {
            const keyword = match[2];
            console.log(`[unsubscribe] keyword "${keyword}" matched for lead ${lead.id}`);

            // 1. Mark lead as unsubscribed (idempotent)
            const { data: leadRow } = await supabase
              .from("leads")
              .select("unsubscribed, phone")
              .eq("id", lead.id)
              .maybeSingle();

            if (!leadRow?.unsubscribed) {
              await supabase
                .from("leads")
                .update({
                  unsubscribed: true,
                  unsubscribed_at: activityAt,
                  unsubscribe_reason: `keyword:${keyword}`,
                })
                .eq("id", lead.id);

              // 2. Log it
              await supabase.from("unsubscribe_logs").insert({
                user_id: resolvedUserId,
                lead_id: lead.id,
                phone: lead.phone || cleanPhone,
                keyword_matched: keyword,
                source_message: text.slice(0, 500),
                source: "whatsapp_inbound",
                account_id: resolvedAccountId,
              });

              // 3. Add to blacklist (idempotent)
              await supabase.from("lead_blacklist").insert({
                user_id: resolvedUserId,
                lead_id: lead.id,
                phone: lead.phone || cleanPhone,
                reason: "unsubscribe_keyword",
              });

              // 4. Cancel active flow executions for this lead
              await supabase
                .from("flow_executions")
                .update({ status: "cancelled", updated_at: activityAt })
                .eq("lead_id", lead.id)
                .in("status", ["running", "waiting_delay", "waiting_no_response"]);

              // 5. Remove lead from pending/paused broadcast jobs
              const { data: pendingJobs } = await supabase
                .from("broadcast_jobs")
                .select("id, lead_ids")
                .eq("user_id", resolvedUserId)
                .in("status", ["pending", "paused", "scheduled", "running"]);

              for (const job of (pendingJobs || []) as Array<{ id: string; lead_ids: string[] }>) {
                if (Array.isArray(job.lead_ids) && job.lead_ids.includes(lead.id)) {
                  const cleaned = job.lead_ids.filter((id) => id !== lead.id);
                  await supabase
                    .from("broadcast_jobs")
                    .update({ lead_ids: cleaned })
                    .eq("id", job.id);
                }
              }

              // 6. Optional auto-reply
              try {
                const { data: settings } = await supabase
                  .from("app_settings")
                  .select("key, value")
                  .in("key", ["unsubscribe_auto_reply_enabled", "unsubscribe_auto_reply_text"]);
                const settingsMap = new Map(
                  (settings || []).map((s: { key: string; value: string }) => [s.key, s.value]),
                );
                const enabled = (settingsMap.get("unsubscribe_auto_reply_enabled") || "true") === "true";
                const replyText =
                  settingsMap.get("unsubscribe_auto_reply_text") || "Você foi removido da lista. 👍";

                if (enabled) {
                  await fetch(`${supabaseUrl}/functions/v1/whatsapp-cloud-send`, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "Authorization": `Bearer ${supabaseKey}`,
                    },
                    body: JSON.stringify({
                      phone: cleanPhone,
                      message: replyText,
                      lead_id: lead.id,
                      account_id: resolvedAccountId,
                    }),
                  });
                }
              } catch (replyErr) {
                console.error("[unsubscribe] auto-reply error:", replyErr);
              }
            }

            unsubscribedThisMessage = true;
          }
        } catch (unsubErr) {
          console.error("[unsubscribe] detection error:", unsubErr);
        }
      }

      if (unsubscribedThisMessage) {
        // Don't fire AI auto-reply or campaign tracking after opt-out.
        continue;
      }

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

      // Check for flow executions waiting for user reply.
      // IMPORTANT: a Brazilian phone can exist as two leads (with/without the 9th digit),
      // so look up all leads matching any phone variant for this tenant and consider their executions.
      if ((buttonPayload || text) && lead) {
        let siblingLeadsQuery = supabase
          .from("leads")
          .select("id")
          .or(phoneFilter);
        if (resolvedUserId) {
          siblingLeadsQuery = siblingLeadsQuery.eq("user_id", resolvedUserId);
        }
        const { data: siblingLeads } = await siblingLeadsQuery;
        const leadIds = Array.from(new Set([
          lead.id,
          ...(siblingLeads || []).map((l: any) => l.id),
        ]));

        const { data: executions } = await supabase
          .from("flow_executions")
          .select("id, current_step_id, flow_id, metadata, lead_id, status, updated_at")
          .in("lead_id", leadIds)
          .in("status", ["waiting_reply", "running", "waiting_no_response"]);

        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

        const activeExecutions = executions || [];
        console.log("Flow reply lookup:", JSON.stringify({
          leadId: lead.id,
          leadIds,
          cleanPhone,
          phoneVariants,
          buttonPayload,
          buttonTitle,
          text: text ? text.slice(0, 120) : "",
          accountId: resolvedAccountId,
          executionCount: activeExecutions.length,
          executions: activeExecutions.map((exec: any) => ({
            id: exec.id,
            status: exec.status,
            flowId: exec.flow_id,
            leadId: exec.lead_id,
            currentStepId: exec.current_step_id,
            updatedAt: exec.updated_at,
          })),
        }));

        if (buttonPayload && activeExecutions.length === 0) {
          const { data: recentExecutions } = await supabase
            .from("flow_executions")
            .select("id, status, current_step_id, flow_id, lead_id, updated_at")
            .in("lead_id", leadIds)
            .order("updated_at", { ascending: false })
            .limit(5);
          console.warn("Button reply received but no active execution was found:", JSON.stringify({
            leadId: lead.id,
            leadIds,
            buttonPayload,
            buttonTitle,
            recentExecutions: recentExecutions || [],
          }));
        }

        if (activeExecutions.length > 0) {
          for (const exec of activeExecutions) {
            // If it's 'running', only consider it if it's stuck (updated > 5 mins ago)
            if (exec.status === "running") {
              const updatedAt = new Date(exec.updated_at);
              const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
              if (updatedAt > fiveMinutesAgo) {
                console.log("Skipping 'running' execution (not stuck yet):", exec.id);
                continue;
              }
              console.log("Recovering stuck 'running' execution:", exec.id);
            }

            // Resolve the exact lead this execution is tied to (may differ from
            // `lead` when two leads exist for the same phone — with/without 9th digit).
            let execLead: any = lead;
            if (exec.lead_id && exec.lead_id !== lead.id) {
              const { data: el } = await supabase
                .from("leads")
                .select("id, name, phone")
                .eq("id", exec.lead_id)
                .maybeSingle();
              if (el) execLead = el;
            }

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
                stepMatchesTriggers(s, candidateTriggers)
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
                  await processFlowStep(condChildren[0], exec, execLead, supabase, resolvedAccountId);
                } else {
                  console.log("Condition matched but has no child step:", matchedStep.id, "exec:", exec.id);
                  await supabase.from("flow_executions").update({
                    status: "completed",
                    updated_at: new Date().toISOString(),
                  }).eq("id", exec.id);
                }
              } else {
                await processFlowStep(matchedStep, exec, execLead, supabase, resolvedAccountId);
              }
            } else {
              console.log("No matching branch for button payload:", buttonPayload, "exec:", exec.id);
              await supabase.from("flow_executions").update({
                status: "waiting_reply",
                updated_at: new Date().toISOString(),
              }).eq("id", exec.id);
            }
          }
        } else if (text && resolvedUserId) {
          // No active execution, check for new flow trigger keywords
          const candidateTriggers = [normalizeTriggerValue(text)];
          const { data: triggerSteps } = await supabase
            .from("flow_steps")
            .select("*, flows:flows!inner(id, user_id, active)")
            .eq("flows.user_id", resolvedUserId)
            .eq("flows.active", true)
            .is("parent_step_id", null);

          const matchedTriggerStep = (triggerSteps || []).find(step => stepMatchesTriggers(step, candidateTriggers));
          if (matchedTriggerStep) {
            const { data: newExec, error: execErr } = await supabase
              .from("flow_executions")
              .insert({
                flow_id: matchedTriggerStep.flow_id,
                lead_id: lead.id,
                status: "running",
                current_step_id: matchedTriggerStep.id,
                metadata: { account_id: resolvedAccountId, trigger: "keyword" }
              })
              .select()
              .single();

            if (!execErr && newExec) {
              await processFlowStep(matchedTriggerStep, newExec, lead, supabase, resolvedAccountId);
            }
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

  // Prefer the account that received the inbound reply (so conversation continues on
  // the same number the lead is talking to). Fall back to the account stored on the
  // execution metadata only when we don't know which account received the webhook.
  const accountId = fallbackAccountId
    || (typeof execution.metadata?.account_id === "string" && execution.metadata.account_id
        ? execution.metadata.account_id
        : null);

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

    // Attach media if present (works as media-only or media + caption)
    if (step.step_type === "message" && step.media_url) {
      body.media_url = step.media_url;
      body.media_type = step.media_type || "image";
      if (step.file_name) body.file_name = step.file_name;
    }

    // Only send if there's something to send — if empty, skip and advance to next step
    if (!body.message && !body.template_name && !body.interactive_buttons && !body.cta_url && !body.media_url) {
      console.warn("processFlowStep: empty step, skipping and advancing:", step.id);
      await advanceExecution(execution, step, lead, supabase);
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
    if (
      currentStep.step_type === "cta_url" &&
      childSteps.length === 1 &&
      childSteps[0].step_type === "condition"
    ) {
      const { data: conditionChildren } = await supabase
        .from("flow_steps")
        .select("*")
        .eq("flow_id", execution.flow_id)
        .eq("parent_step_id", childSteps[0].id)
        .order("step_order");

      if (conditionChildren && conditionChildren.length > 0) {
        await processFlowStep(conditionChildren[0], execution, lead, supabase, execution.metadata?.account_id || null);
        return;
      }

      await supabase.from("flow_executions").update({ status: "completed" }).eq("id", execution.id);
      return;
    }

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
