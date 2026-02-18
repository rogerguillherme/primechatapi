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

    // Find executions where delay has expired
    const now = new Date().toISOString();
    const { data: readyExecutions } = await supabase
      .from("flow_executions")
      .select("*, current_step:flow_steps!current_step_id(*)")
      .eq("status", "waiting_delay")
      .lte("next_action_at", now);

    if (!readyExecutions || readyExecutions.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, processed: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let processed = 0;

    for (const exec of readyExecutions) {
      try {
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

        // Process the CURRENT step first
        if (currentStep.step_type === "message" || currentStep.step_type === "interactive_buttons" || currentStep.step_type === "cta_url") {
          const sent = await sendStepMessage(currentStep, lead, supabase, supabaseUrl, supabaseKey, exec.metadata);
          if (!sent) {
            console.error("Failed to send message for execution:", exec.id);
            continue; // Don't advance if send failed
          }
        }

        // Now advance to next step
        await advanceToNextStep(exec, currentStep, lead, supabase, supabaseUrl, supabaseKey);
        processed++;
      } catch (stepErr) {
        console.error("Error processing execution:", exec.id, stepErr);
      }
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
  step: any, lead: any, supabase: any, supabaseUrl: string, supabaseKey: string, metadata?: any
): Promise<boolean> {
  const body: any = { phone: lead.phone, lead_id: lead.id };

  if (step.step_type === "cta_url") {
    const buttons = Array.isArray(step.buttons) ? step.buttons : [];
    const ctaBtn = buttons[0];
    const codigo = metadata?.codigo || "";
    const msgText = (step.custom_message || "Acesse o link abaixo:")
      .replace(/\{nome\}/g, lead.name.split(" ")[0])
      .replace(/\{codigo\}/g, codigo);
    body.message = msgText;
    if (ctaBtn?.url) {
      body.cta_url = { display_text: ctaBtn.title || "Acessar", url: ctaBtn.url };
    }
  } else if (step.step_type === "interactive_buttons") {
    // Interactive button message
    const buttons = Array.isArray(step.buttons) ? step.buttons : [];
    const codigo = metadata?.codigo || "";
    const msgText = (step.custom_message || "Escolha uma opção:")
      .replace(/\{nome\}/g, lead.name.split(" ")[0])
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
      const codigo = metadata?.codigo || "";
      const rawParams = (template.template_params || []) as any[];
      body.template_params = rawParams.map((p: any) => {
        const text = typeof p === "string" ? p : p?.text || "";
        const resolved = text
          .replace(/\{nome\}/g, lead.name.split(" ")[0])
          .replace(/\{codigo\}/g, codigo);
        return { type: "text", text: resolved || lead.name.split(" ")[0] };
      });
    } else if (template) {
      body.message = template.content;
    }
  } else if (step.custom_message) {
    const codigo = metadata?.codigo || "";
    body.message = step.custom_message
      .replace(/\{nome\}/g, lead.name.split(" ")[0])
      .replace(/\{codigo\}/g, codigo);
  }

  // Only send if there's something to send
  if (!body.message && !body.template_name && !body.interactive_buttons && !body.cta_url) {
    console.error("No message, template, buttons or cta_url to send for step:", step.id);
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

  await sendRes.text(); // consume body
  return true;
}

async function advanceToNextStep(
  exec: any, currentStep: any, lead: any,
  supabase: any, supabaseUrl: string, supabaseKey: string
) {
  const { data: nextSteps } = await supabase
    .from("flow_steps")
    .select("*")
    .eq("flow_id", exec.flow_id)
    .gt("step_order", currentStep.step_order)
    .order("step_order")
    .limit(1);

  if (!nextSteps || nextSteps.length === 0) {
    await supabase.from("flow_executions").update({ status: "completed" }).eq("id", exec.id);
    return;
  }

  const nextStep = nextSteps[0];

  if (nextStep.step_type === "delay") {
    await supabase.from("flow_executions").update({
      current_step_id: nextStep.id,
      status: "waiting_delay",
      next_action_at: new Date(Date.now() + nextStep.delay_minutes * 60 * 1000).toISOString(),
    }).eq("id", exec.id);
  } else if (nextStep.step_type === "condition") {
    await supabase.from("flow_executions").update({
      current_step_id: nextStep.id,
      status: "waiting_reply",
    }).eq("id", exec.id);
  } else if (nextStep.step_type === "message" || nextStep.step_type === "interactive_buttons" || nextStep.step_type === "cta_url") {
    // Set as waiting_delay with immediate execution so next cron picks it up
    await supabase.from("flow_executions").update({
      current_step_id: nextStep.id,
      status: "waiting_delay",
      next_action_at: new Date().toISOString(),
    }).eq("id", exec.id);
  }
}
