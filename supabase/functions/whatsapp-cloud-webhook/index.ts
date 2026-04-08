import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

    // Meta sends a wrapper object
    const entry = payload.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    if (!value) {
      return new Response(
        JSON.stringify({ ok: true, skipped: "no value" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Handle status updates
    if (value.statuses) {
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

          // ── AUTO-TRACK: Register campaign event for delivered/read ──
          if (status === "delivered" || status === "read") {
            // Find the message_log to get campaign_id
            const { data: msgLog } = await sb
              .from("message_logs")
              .select("job_id, lead_id, phone")
              .eq("wa_message_id", waMessageId)
              .maybeSingle();

            if (msgLog?.job_id) {
              await sb.from("campaign_events").insert({
                campaign_id: msgLog.job_id,
                lead_id: msgLog.lead_id,
                lead_phone: msgLog.phone,
                event_type: status,
              }).catch(() => {});
            }
          }
        }
      }
      
      return new Response(
        JSON.stringify({ ok: true, type: "status_update" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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
        JSON.stringify({ ok: true, skipped: "no messages" }),
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

      // Save message
      const contentText = text || (mediaType === "audio" ? "🎤 Áudio" : mediaType === "image" ? "📷 Imagem" : mediaType === "video" ? "🎥 Vídeo" : "📎 Arquivo");

      await supabase.from("chat_messages").insert({
        lead_id: lead!.id,
        direction: "inbound",
        content: contentText,
        media_type: mediaType,
        media_url: mediaUrl,
        zapi_message_id: messageId,
        status: "received",
      });

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

      // Check for flow executions waiting for button reply
      if (buttonPayload && lead) {
        const { data: executions } = await supabase
          .from("flow_executions")
          .select("id, current_step_id, flow_id, metadata")
          .eq("lead_id", lead.id)
          .eq("status", "waiting_reply");

        for (const exec of executions || []) {
          const currentStepId = exec.current_step_id;

          // BRANCHING: look for child steps matching trigger_value via parent_step_id
          let matchedStep: any = null;

          if (currentStepId) {
            // Find child step whose trigger_value matches the button id or title
            const { data: childSteps } = await supabase
              .from("flow_steps")
              .select("*")
              .eq("flow_id", exec.flow_id)
              .eq("parent_step_id", currentStepId);

            if (childSteps && childSteps.length > 0) {
              // Try matching by button id first, then by title
              matchedStep = childSteps.find((s: any) => s.trigger_value === buttonPayload)
                || (buttonTitle ? childSteps.find((s: any) => s.trigger_value === buttonTitle) : null)
                || null;
            }
          }

          // Fallback: old linear approach (condition node by trigger_value)
          if (!matchedStep) {
            const { data: conditionSteps } = await supabase
              .from("flow_steps")
              .select("*")
              .eq("flow_id", exec.flow_id)
              .eq("step_type", "condition")
              .eq("trigger_value", buttonPayload);

            if (conditionSteps && conditionSteps.length > 0) {
              const conditionStep = conditionSteps[0];
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

          if (matchedStep) {
            await processFlowStep(matchedStep, exec, lead, supabase);
          } else {
            console.log("No matching branch for button payload:", buttonPayload, "exec:", exec.id);
            await supabase.from("flow_executions").update({ status: "completed" }).eq("id", exec.id);
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
    return new Response(
      JSON.stringify({ error: error.message }),
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

async function processFlowStep(step: any, execution: any, lead: any, supabase: any) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Resolve account_id from the default WhatsApp account
  const { data: defaultAccount } = await supabase
    .from("whatsapp_accounts")
    .select("id")
    .eq("is_default", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const accountId = defaultAccount?.id || null;

  if (step.step_type === "message" || step.step_type === "cta_url" || step.step_type === "interactive_buttons") {
    const body: any = { phone: lead.phone || lead.name, lead_id: lead.id };
    if (accountId) body.account_id = accountId;

    if (step.step_type === "cta_url") {
      const buttons = Array.isArray(step.buttons) ? step.buttons : [];
      const ctaBtn = buttons[0];
      const codigo = execution.metadata?.codigo || "";
      const msgText = (step.custom_message || "Acesse o link abaixo:")
        .replace(/\{nome\}/g, (lead.name || "").split(" ")[0])
        .replace(/\{codigo\}/g, codigo);
      body.message = msgText;
      if (ctaBtn?.url) {
        body.cta_url = { display_text: ctaBtn.title || "Acessar", url: ctaBtn.url };
      }
    } else if (step.step_type === "interactive_buttons") {
      const buttons = Array.isArray(step.buttons) ? step.buttons : [];
      const codigo = execution.metadata?.codigo || "";
      const msgText = (step.custom_message || "Escolha uma opção:")
        .replace(/\{nome\}/g, (lead.name || "").split(" ")[0])
        .replace(/\{codigo\}/g, codigo);
      body.message = msgText;
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
        const codigo = execution.metadata?.codigo || "";
        const firstName = (lead.name || "").split(" ")[0];
        const rawParams = (template.template_params || []) as any[];
        body.template_params = rawParams.map((p: any) => {
          const text = typeof p === "string" ? p : p?.text || "";
          const resolved = text
            .replace(/\{nome\}/g, firstName)
            .replace(/\{codigo\}/g, codigo)
            .replace(/\{\{\d+\}\}/g, firstName);
          return { type: "text", text: resolved || firstName };
        });
      } else if (template) {
        body.message = template.content;
      }
    } else if (step.custom_message) {
      const codigo = execution.metadata?.codigo || "";
      body.message = step.custom_message
        .replace(/\{nome\}/g, (lead.name || "").split(" ")[0])
        .replace(/\{codigo\}/g, codigo);
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
      await processFlowStep(childSteps[0], execution, lead, supabase);
      return;
    }
    // Multiple children = branching (interactive_buttons sends all then waits)
    if (currentStep.step_type === "interactive_buttons") {
      await supabase.from("flow_executions").update({
        current_step_id: currentStep.id,
        status: "waiting_reply",
      }).eq("id", execution.id);
      return;
    }
    // Default: take first child
    await processFlowStep(childSteps[0], execution, lead, supabase);
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

  await processFlowStep(nextSteps[0], execution, lead, supabase);
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
