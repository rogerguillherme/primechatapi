import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Find the default WhatsApp account to use for sending
    const { data: defaultAccount } = await supabase
      .from("whatsapp_accounts")
      .select("id")
      .eq("is_default", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const accountId = defaultAccount?.id || null;
    console.log("Using account_id:", accountId);

    // Find executions where delay/timeout has expired (batch limit to avoid timeout)
    const BATCH_LIMIT = 10;
    const now = new Date().toISOString();
    const { data: readyExecutions } = await supabase
      .from("flow_executions")
      .select("*, current_step:flow_steps!current_step_id(*)")
      .in("status", ["waiting_delay", "waiting_no_response"])
      .lte("next_action_at", now)
      .order("next_action_at", { ascending: true })
      .limit(BATCH_LIMIT);

    if (!readyExecutions || readyExecutions.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, processed: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let processed = 0;

    for (const exec of readyExecutions) {
      try {
        // Retry limit
        const attempts = (exec.metadata?.send_attempts || 0) + 1;
        if (attempts > 5) {
          console.error("Max retry attempts reached for execution:", exec.id);
          await supabase.from("flow_executions").update({ status: "failed" }).eq("id", exec.id);
          continue;
        }
        await supabase.from("flow_executions").update({
          metadata: { ...exec.metadata, send_attempts: attempts },
        }).eq("id", exec.id);

        // Get the lead
        const { data: lead } = await supabase
          .from("leads")
          .select("id, name, phone")
          .eq("id", exec.lead_id)
          .single();

        if (!lead) {
          await supabase.from("flow_executions").update({ status: "cancelled" }).eq("id", exec.id);
          continue;
        }

        const currentStep = exec.current_step;
        if (!currentStep) {
          await supabase.from("flow_executions").update({ status: "completed" }).eq("id", exec.id);
          continue;
        }

        // Handle no_response timeout: advance past this step
        if (currentStep.step_type === "no_response" || exec.status === "waiting_no_response") {
          await advanceToNextStep(exec, currentStep, lead, supabase, supabaseUrl, supabaseKey, accountId);
          processed++;
          continue;
        }

        // Process the CURRENT step (send message)
        if (currentStep.step_type === "message" || currentStep.step_type === "interactive_buttons" || currentStep.step_type === "cta_url") {
          const sent = await sendStepMessage(currentStep, lead, supabase, supabaseUrl, supabaseKey, exec.metadata, accountId);
          if (!sent) {
            console.error("Failed to send message for execution:", exec.id);
            continue;
          }
        }

        // Now advance to next step
        await advanceToNextStep(exec, currentStep, lead, supabase, supabaseUrl, supabaseKey, accountId);
        processed++;
      } catch (stepErr) {
        console.error("Error processing execution:", exec.id, stepErr);
      }
    }

    // Check if there are more ready executions (beyond this batch) or future ones
    const { data: moreReady } = await supabase
      .from("flow_executions")
      .select("next_action_at")
      .in("status", ["waiting_delay", "waiting_no_response"])
      .order("next_action_at")
      .limit(1);

    if (moreReady && moreReady.length > 0) {
      const nextAt = new Date(moreReady[0].next_action_at).getTime();
      const nowMs = Date.now();
      // If there are immediately ready ones (processed batch was full), chain quickly
      const delayMs = nextAt <= nowMs ? 1000 : Math.min(nextAt - nowMs, 55000);

      setTimeout(async () => {
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
          console.error("Self-invocation failed:", e);
        }
      }, delayMs);
    }

    return new Response(
      JSON.stringify({ ok: true, processed }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Flow processor error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function sendStepMessage(
  step: any, lead: any, supabase: any, supabaseUrl: string, supabaseKey: string, metadata?: any, accountId?: string | null
): Promise<boolean> {
  const body: any = { phone: lead.phone, lead_id: lead.id };
  if (accountId) body.account_id = accountId;
  const firstName = (lead.name || "").split(" ")[0];
  const codigo = metadata?.codigo || "";

  if (step.step_type === "cta_url") {
    const buttons = Array.isArray(step.buttons) ? step.buttons : [];
    const ctaBtn = buttons[0];
    const msgText = (step.custom_message || "Acesse o link abaixo:")
      .replace(/\{nome\}/g, firstName)
      .replace(/\{codigo\}/g, codigo)
      .replace(/\{\{\d+\}\}/g, firstName);
    body.message = msgText;
    if (ctaBtn?.url) {
      body.cta_url = { display_text: ctaBtn.title || "Acessar", url: ctaBtn.url };
    }
  } else if (step.step_type === "interactive_buttons") {
    const buttons = Array.isArray(step.buttons) ? step.buttons : [];
    const msgText = (step.custom_message || "Escolha uma opção:")
      .replace(/\{nome\}/g, firstName)
      .replace(/\{codigo\}/g, codigo)
      .replace(/\{\{\d+\}\}/g, firstName);
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

  if (!body.message && !body.template_name && !body.interactive_buttons && !body.cta_url) {
    console.error("No message to send for step:", step.id);
    return false;
  }

  console.log("Sending message for step:", step.id, JSON.stringify(body));

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
    console.error("whatsapp-cloud-send failed:", sendRes.status, errText);
    return false;
  }

  await sendRes.text();
  return true;
}

async function advanceToNextStep(
  exec: any, currentStep: any, lead: any,
  supabase: any, supabaseUrl: string, supabaseKey: string, accountId?: string | null
) {
  // BRANCHING: find children by parent_step_id first
  let nextStep: any = null;

  const { data: childSteps } = await supabase
    .from("flow_steps")
    .select("*")
    .eq("flow_id", exec.flow_id)
    .eq("parent_step_id", currentStep.id)
    .order("step_order");

  if (childSteps && childSteps.length > 0) {
    if (childSteps.length === 1) {
      // Single child, just advance
      nextStep = childSteps[0];
    } else {
      // Multiple children = branching point (e.g., interactive_buttons)
      // If current step is interactive_buttons, we need to wait for button click
      if (currentStep.step_type === "interactive_buttons") {
        // Set status to waiting_reply so webhook handles the button click
        await supabase.from("flow_executions").update({
          current_step_id: currentStep.id,
          status: "waiting_reply",
        }).eq("id", exec.id);
        return;
      }
      // For other types with multiple children, take the first
      nextStep = childSteps[0];
    }
  } else {
    // Fallback: linear ordering (backwards compat)
    const { data: nextSteps } = await supabase
      .from("flow_steps")
      .select("*")
      .eq("flow_id", exec.flow_id)
      .gt("step_order", currentStep.step_order)
      .is("parent_step_id", null)
      .order("step_order")
      .limit(1);

    if (nextSteps && nextSteps.length > 0) {
      nextStep = nextSteps[0];
    }
  }

  if (!nextStep) {
    await supabase.from("flow_executions").update({ status: "completed" }).eq("id", exec.id);
    return;
  }

  if (nextStep.step_type === "delay") {
    await supabase.from("flow_executions").update({
      current_step_id: nextStep.id,
      status: "waiting_delay",
      next_action_at: new Date(Date.now() + nextStep.delay_minutes * 60 * 1000).toISOString(),
    }).eq("id", exec.id);
  } else if (nextStep.step_type === "no_response") {
    const timeoutMin = nextStep.timeout_minutes || 10;
    await supabase.from("flow_executions").update({
      current_step_id: nextStep.id,
      status: "waiting_no_response",
      next_action_at: new Date(Date.now() + timeoutMin * 60 * 1000).toISOString(),
    }).eq("id", exec.id);
  } else if (nextStep.step_type === "condition") {
    await supabase.from("flow_executions").update({
      current_step_id: nextStep.id,
      status: "waiting_reply",
    }).eq("id", exec.id);
  } else if (nextStep.step_type === "message" || nextStep.step_type === "interactive_buttons" || nextStep.step_type === "cta_url") {
    // Immediate execution
    await supabase.from("flow_executions").update({
      current_step_id: nextStep.id,
      status: "waiting_delay",
      next_action_at: new Date().toISOString(),
    }).eq("id", exec.id);
  }
}
