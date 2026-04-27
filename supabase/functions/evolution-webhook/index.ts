// Webhook receiver for Evolution API (self-hosted)
// Configure on each instance: POST {SUPABASE_URL}/functions/v1/evolution-webhook?account_id={id}
// Subscribe events: messages.upsert, messages.update, connection.update

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    .select("id, step_type, parent_step_id, buttons")
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

  let expandedTriggers = [...candidateTriggers];
  if (currentStep.step_type === "interactive_buttons") {
    const buttons = Array.isArray(currentStep.buttons) ? currentStep.buttons : [];
    for (const trigger of candidateTriggers) {
      const match = trigger.match(/^(\d+)$/);
      if (!match) continue;
      const buttonIndex = Number(match[1]) - 1;
      const button = buttons[buttonIndex];
      if (button?.title) {
        expandedTriggers.push(normalizeTriggerValue(button.title));
      }
    }
  }

  expandedTriggers = Array.from(new Set(expandedTriggers.filter(Boolean)));

  return branchSteps.find((step: any) => expandedTriggers.includes(normalizeTriggerValue(step.trigger_value))) || null;
}

async function processFlowStep(step: any, execution: any, lead: any, supabase: any, fallbackAccountId?: string | null) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const accountId = execution.metadata?.account_id || fallbackAccountId || null;

  if (step.step_type === "message" || step.step_type === "cta_url" || step.step_type === "interactive_buttons") {
    const body: any = { phone: lead.phone, lead_id: lead.id };
    if (accountId) body.account_id = accountId;

    const codigo = execution.metadata?.codigo || "";
    const firstName = (lead.name || "").split(" ")[0];

    // Attach media (image or document/PDF) when present on the step
    if (step.media_url && step.media_type) {
      body.media_url = step.media_url;
      body.media_type = step.media_type;
    }

    if (step.step_type === "cta_url") {
      const buttons = Array.isArray(step.buttons) ? step.buttons : [];
      const ctaBtn = buttons[0];
      body.message = (step.custom_message || "Acesse o link abaixo:")
        .replace(/\{nome\}/g, firstName)
        .replace(/\{codigo\}/g, codigo)
        .replace(/\{\{\d+\}\}/g, firstName);
      if (ctaBtn?.url) {
        body.cta_url = { display_text: ctaBtn.title || "Acessar", url: ctaBtn.url };
      }
    } else if (step.step_type === "interactive_buttons") {
      body.message = (step.custom_message || "Escolha uma opção:")
        .replace(/\{nome\}/g, firstName)
        .replace(/\{codigo\}/g, codigo)
        .replace(/\{\{\d+\}\}/g, firstName);
      body.interactive_buttons = Array.isArray(step.buttons) ? step.buttons : [];
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
      body.message = step.custom_message
        .replace(/\{nome\}/g, firstName)
        .replace(/\{codigo\}/g, codigo)
        .replace(/\{\{\d+\}\}/g, firstName);
    }

    if (!body.message && !body.template_name && !body.interactive_buttons && !body.cta_url && !body.media_url) {
      console.error("Evolution processFlowStep: nothing to send for step:", step.id);
      return;
    }

    console.log("Evolution processFlowStep sending:", step.id, JSON.stringify(body));
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
      console.error("Evolution processFlowStep send failed:", sendRes.status, errText);
      return;
    }

    await sendRes.text();
    await advanceExecution(execution, step, lead, supabase, accountId);
  } else if (step.step_type === "delay") {
    await supabase.from("flow_executions").update({
      current_step_id: step.id,
      status: "waiting_delay",
      next_action_at: new Date(Date.now() + (step.delay_minutes || 0) * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", execution.id);
  } else if (step.step_type === "no_response") {
    const timeoutMin = step.timeout_minutes || 10;
    await supabase.from("flow_executions").update({
      current_step_id: step.id,
      status: "waiting_no_response",
      next_action_at: new Date(Date.now() + timeoutMin * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", execution.id);
  } else if (step.step_type === "condition") {
    await supabase.from("flow_executions").update({
      current_step_id: step.id,
      status: "waiting_reply",
      updated_at: new Date().toISOString(),
    }).eq("id", execution.id);
  }
}

async function advanceExecution(execution: any, currentStep: any, lead: any, supabase: any, accountId?: string | null) {
  const { data: childSteps } = await supabase
    .from("flow_steps")
    .select("*")
    .eq("flow_id", execution.flow_id)
    .eq("parent_step_id", currentStep.id)
    .order("step_order");

  if (childSteps && childSteps.length > 0) {
    if (childSteps.length === 1) {
      await processFlowStep(childSteps[0], execution, lead, supabase, accountId);
      return;
    }

    const hasConditionalBranches = childSteps.some((step: any) => step.step_type === "condition");
    if (currentStep.step_type === "interactive_buttons" || hasConditionalBranches) {
      await supabase.from("flow_executions").update({
        current_step_id: currentStep.id,
        status: "waiting_reply",
        updated_at: new Date().toISOString(),
      }).eq("id", execution.id);
      return;
    }

    await processFlowStep(childSteps[0], execution, lead, supabase, accountId);
    return;
  }

  const { data: nextSteps } = await supabase
    .from("flow_steps")
    .select("*")
    .eq("flow_id", execution.flow_id)
    .gt("step_order", currentStep.step_order)
    .is("parent_step_id", null)
    .order("step_order")
    .limit(1);

  if (!nextSteps || nextSteps.length === 0) {
    await supabase.from("flow_executions").update({
      status: "completed",
      updated_at: new Date().toISOString(),
    }).eq("id", execution.id);
    return;
  }

  await processFlowStep(nextSteps[0], execution, lead, supabase, accountId);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const url = new URL(req.url);
    // Some Evolution servers append the event name to the URL path/query, dirtying account_id (e.g. "uuid/messages-upsert").
    // Sanitize: keep only the leading UUID portion.
    const rawAccountId = url.searchParams.get("account_id") || "";
    const uuidMatch = rawAccountId.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    const accountIdParam = uuidMatch ? uuidMatch[0] : "";

    const payload = await req.json().catch(() => ({}));
    console.log("Evolution webhook received:", JSON.stringify(payload).substring(0, 500));

    const event: string = payload.event || "";
    const instance: string = payload.instance || payload.instanceName || "";

    // Resolve account by id, then fall back to instance slug
    let account: any = null;
    if (accountIdParam) {
      const { data } = await supabase
        .from("whatsapp_accounts")
        .select("id, user_id, phone_number_id")
        .eq("provider", "evolution")
        .eq("id", accountIdParam)
        .maybeSingle();
      account = data;
    }
    if (!account && instance) {
      const { data } = await supabase
        .from("whatsapp_accounts")
        .select("id, user_id, phone_number_id")
        .eq("provider", "evolution")
        .eq("phone_number_id", instance)
        .maybeSingle();
      account = data;
    }

    if (!account) {
      console.log("No matching evolution account for instance:", instance, "param:", accountIdParam, "raw:", rawAccountId);
      return new Response(JSON.stringify({ ok: true, ignored: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ============= Incoming message =============
    if (event === "messages.upsert" || event === "MESSAGES_UPSERT") {
      const data = payload.data || {};
      const key = data.key || {};
      const remoteJid: string = key.remoteJid || "";
      const fromMe: boolean = !!key.fromMe;
      const messageId: string = key.id || "";

      // Ignore groups & broadcasts
      if (remoteJid.includes("@g.us") || remoteJid.includes("status@broadcast")) {
        return new Response(JSON.stringify({ ok: true, skipped: "group" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const rawPhone = remoteJid.split("@")[0].replace(/\D/g, "");
      if (!rawPhone) {
        return new Response(JSON.stringify({ ok: true, skipped: "noPhone" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Brazilian numbers: handle the 9th digit ambiguity.
      // Mobile format with 9: 55 + DDD(2) + 9 + 8 digits = 13 chars
      // Without 9: 55 + DDD(2) + 8 digits = 12 chars
      // We generate both variants to match leads stored either way.
      const phoneVariants: string[] = [rawPhone];
      if (rawPhone.startsWith("55") && rawPhone.length === 12) {
        // missing 9th digit -> add it
        const ddd = rawPhone.substring(2, 4);
        const rest = rawPhone.substring(4);
        phoneVariants.push(`55${ddd}9${rest}`);
      } else if (rawPhone.startsWith("55") && rawPhone.length === 13) {
        const ddd = rawPhone.substring(2, 4);
        const ninth = rawPhone.substring(4, 5);
        const rest = rawPhone.substring(5);
        if (ninth === "9") {
          phoneVariants.push(`55${ddd}${rest}`);
        }
      }
      // canonical phone used for new leads = the longer (with 9) variant when applicable
      const phone = phoneVariants.length > 1 ? phoneVariants[1] : rawPhone;

      // Dedupe: skip if we already stored this message id (avoids double when our own send echoes back)
      if (messageId) {
        const { data: existing } = await supabase
          .from("chat_messages")
          .select("id")
          .eq("zapi_message_id", messageId)
          .maybeSingle();
        if (existing) {
          return new Response(JSON.stringify({ ok: true, skipped: "duplicate" }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      // Extract text + media
      const msg = data.message || {};
      const text =
        msg.conversation ||
        msg.extendedTextMessage?.text ||
        msg.imageMessage?.caption ||
        msg.videoMessage?.caption ||
        msg.documentMessage?.caption ||
        msg.buttonsResponseMessage?.selectedDisplayText ||
        msg.listResponseMessage?.title ||
        "";

      let mediaType: string | null = null;
      let mediaUrl: string | null = null;
      let mimetype: string | null = null;
      if (msg.imageMessage) { mediaType = "image"; mimetype = msg.imageMessage.mimetype || "image/jpeg"; }
      else if (msg.videoMessage) { mediaType = "video"; mimetype = msg.videoMessage.mimetype || "video/mp4"; }
      else if (msg.audioMessage) { mediaType = "audio"; mimetype = msg.audioMessage.mimetype || "audio/ogg"; }
      else if (msg.documentMessage) { mediaType = "document"; mimetype = msg.documentMessage.mimetype || "application/octet-stream"; }

      // For inbound media: download via Evolution and re-upload to chat-media (WhatsApp URLs are encrypted)
      if (mediaType && messageId && !fromMe) {
        try {
          const evoServer = (account.business_account_id || "").replace(/\/+$/, "");
          const evoKey = account.api_key || account.access_token;
          const evoInstance = account.phone_number_id;
          const dlRes = await fetch(`${evoServer}/chat/getBase64FromMediaMessage/${evoInstance}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: evoKey },
            body: JSON.stringify({ message: { key: data.key } }),
          });
          if (dlRes.ok) {
            const dlBody = await dlRes.json();
            const base64: string | undefined = dlBody?.base64 || dlBody?.media?.base64 || dlBody?.data;
            if (base64) {
              const mt = mimetype || "application/octet-stream";
              const ext = (mt.split("/")[1] || "bin").split(";")[0];
              const path = `evolution/${account.user_id}/${Date.now()}-${messageId}.${ext}`;
              const bin = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
              const { error: upErr } = await supabase.storage
                .from("chat-media")
                .upload(path, bin, { contentType: mt, upsert: true });
              if (!upErr) {
                const { data: pub } = supabase.storage.from("chat-media").getPublicUrl(path);
                mediaUrl = pub.publicUrl;
              } else {
                console.error("Evolution media upload failed:", upErr.message);
              }
            }
          } else {
            console.error("Evolution media download failed:", dlRes.status, await dlRes.text());
          }
        } catch (mediaErr) {
          console.error("Evolution media handling error:", mediaErr);
        }
      }

      const pushName: string = data.pushName || phone;
      const direction = fromMe ? "outbound" : "inbound";

      // Upsert lead by phone (try all variants to handle BR 9th digit ambiguity)
      const { data: existingLeads } = await supabase
        .from("leads")
        .select("id, phone")
        .in("phone", phoneVariants)
        .eq("user_id", account.user_id)
        .limit(1);

      const existingLead = existingLeads && existingLeads.length > 0 ? existingLeads[0] : null;

      let leadId = existingLead?.id;
      if (!leadId) {
        const { data: newLead, error: leadErr } = await supabase
          .from("leads")
          .insert({
            user_id: account.user_id,
            phone,
            name: pushName,
            origin: "evolution",
            chat_status: fromMe ? "respondidas" : "aguardando_respostas",
          })
          .select("id")
          .single();
        if (leadErr) {
          console.error("Failed to create lead:", leadErr);
          return new Response(JSON.stringify({ error: leadErr.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        leadId = newLead.id;
      }

      // Insert chat message (inbound from contact OR outbound sent from the phone)
      await supabase.from("chat_messages").insert({
        lead_id: leadId,
        direction,
        content: text || (mediaType ? `[${mediaType}]` : "(sem conteúdo)"),
        media_type: mediaType,
        media_url: mediaUrl,
        zapi_message_id: messageId,
        status: fromMe ? "sent" : "received",
        account_id: account.id,
      });

      // Continue waiting flows on real inbound replies
      if (!fromMe) {
        const { data: lead } = await supabase
          .from("leads")
          .select("id, name, phone")
          .eq("id", leadId)
          .maybeSingle();

        if (lead && text) {
          const { data: executions } = await supabase
            .from("flow_executions")
            .select("id, current_step_id, flow_id, metadata")
            .eq("lead_id", lead.id)
            .eq("status", "waiting_reply");

          for (const exec of executions || []) {
            const candidateTriggers = Array.from(new Set([
              normalizeTriggerValue(text),
            ].filter(Boolean)));

            let matchedStep: any = await resolveMatchedFlowStep(
              supabase,
              exec.flow_id,
              exec.current_step_id,
              candidateTriggers,
            );

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
                const { data: condChildren } = await supabase
                  .from("flow_steps")
                  .select("*")
                  .eq("flow_id", exec.flow_id)
                  .eq("parent_step_id", conditionStep.id)
                  .order("step_order")
                  .limit(1);

                if (condChildren && condChildren.length > 0) {
                  matchedStep = condChildren[0];
                }
              }
            }

            console.log("Evolution flow reply resolution:", JSON.stringify({
              executionId: exec.id,
              currentStepId: exec.current_step_id,
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
                  await processFlowStep(condChildren[0], exec, lead, supabase, account.id);
                } else {
                  await supabase.from("flow_executions").update({
                    status: "completed",
                    updated_at: new Date().toISOString(),
                  }).eq("id", exec.id);
                }
              } else {
                await processFlowStep(matchedStep, exec, lead, supabase, account.id);
              }
            } else {
              await supabase.from("flow_executions").update({
                status: "waiting_reply",
                updated_at: new Date().toISOString(),
              }).eq("id", exec.id);
            }
          }
        }

        try {
          await fetch(`${supabaseUrl}/functions/v1/flow-processor`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify({ inbound_lead_id: leadId, inbound_text: text }),
          }).catch(() => {});
        } catch {}

        // ── AI AUTO-REPLY: trigger AI agent for inbound text messages ──
        if (text) {
          try {
            const aiRes = await fetch(`${supabaseUrl}/functions/v1/ai-auto-reply`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${supabaseKey}`,
              },
              body: JSON.stringify({
                lead_id: leadId,
                message: text,
                account_id: account.id,
              }),
            });
            if (!aiRes.ok) {
              console.error("Evolution AI auto-reply failed:", aiRes.status, await aiRes.text());
            } else {
              const aiResult = await aiRes.json();
              console.log("Evolution AI auto-reply result:", JSON.stringify(aiResult));
            }
          } catch (aiErr) {
            console.error("Evolution AI auto-reply error:", aiErr);
          }
        }
      }

      return new Response(JSON.stringify({ ok: true, lead_id: leadId, direction }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ============= Status updates =============
    if (event === "messages.update" || event === "MESSAGES_UPDATE") {
      const data = payload.data || {};
      const messageId = data.key?.id;
      const status = data.status; // DELIVERY_ACK / READ / etc.
      if (messageId && status) {
        const updates: any = {};
        if (status === "READ" || status === 4) {
          updates.read_at = new Date().toISOString();
          updates.status = "read";
        } else if (status === "DELIVERY_ACK" || status === 3) {
          updates.delivered_at = new Date().toISOString();
          updates.status = "delivered";
        }
        if (Object.keys(updates).length > 0) {
          await supabase.from("chat_messages").update(updates).eq("zapi_message_id", messageId);
        }
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Evolution webhook error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
