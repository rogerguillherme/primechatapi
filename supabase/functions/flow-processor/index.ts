import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const READY_STATUSES = ["waiting_delay", "waiting_no_response"];
const RETRY_DELAY_MS = 5000;
const DUPLICATE_SEND_WINDOW_MS = 15000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const BATCH_LIMIT = 10;
    const now = new Date().toISOString();

    // Early-return: only query account if there's actual work to do
    const { data: readyExecutions } = await supabase
      .from("flow_executions")
      .select("*, current_step:flow_steps!current_step_id(*)")
      .in("status", READY_STATUSES)
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
      let claimed = false;

      try {
        claimed = await claimExecution(exec, supabase);
        if (!claimed) {
          continue;
        }

        const { data: lead } = await supabase
          .from("leads")
          .select("id, name, phone")
          .eq("id", exec.lead_id)
          .single();

        if (!lead) {
          await supabase.from("flow_executions").update({
            status: "cancelled",
            updated_at: new Date().toISOString(),
          }).eq("id", exec.id);
          continue;
        }

        const currentStep = exec.current_step;
        if (!currentStep) {
          await supabase.from("flow_executions").update({
            status: "completed",
            updated_at: new Date().toISOString(),
          }).eq("id", exec.id);
          continue;
        }

        let executionAccountId = typeof exec.metadata?.account_id === "string" && exec.metadata.account_id
          ? exec.metadata.account_id
          : null;

        if (!executionAccountId) {
          const { data: recentLeadMessage } = await supabase
            .from("chat_messages")
            .select("account_id")
            .eq("lead_id", lead.id)
            .not("account_id", "is", null)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          executionAccountId = recentLeadMessage?.account_id || null;
        }

        if (currentStep.step_type === "no_response" || exec.status === "waiting_no_response") {
          await advanceToNextStep(exec, currentStep, lead, supabase, supabaseUrl, supabaseKey, executionAccountId);
          processed++;
          continue;
        }

        // BLACKLIST: add lead to blacklist and continue
        if (currentStep.step_type === "blacklist") {
          const { data: flowRow } = await supabase
            .from("flows")
            .select("user_id")
            .eq("id", exec.flow_id)
            .maybeSingle();

          if (flowRow?.user_id) {
            await supabase.from("lead_blacklist").upsert(
              {
                user_id: flowRow.user_id,
                lead_id: lead.id,
                phone: (lead.phone || "").replace(/\D/g, ""),
                reason: currentStep.custom_message || "opt-out via fluxo",
                flow_id: exec.flow_id,
              },
              { onConflict: "user_id,phone", ignoreDuplicates: true }
            );
            console.log("Lead added to blacklist:", lead.id, "via flow:", exec.flow_id);
          }

          await advanceToNextStep(exec, currentStep, lead, supabase, supabaseUrl, supabaseKey, executionAccountId);
          processed++;
          continue;
        }

        if (
          currentStep.step_type === "message" ||
          currentStep.step_type === "interactive_buttons" ||
          currentStep.step_type === "cta_url"
        ) {
          const sent = await sendStepMessage(currentStep, lead, supabase, supabaseUrl, supabaseKey, exec.metadata, executionAccountId);
          if (!sent) {
            console.error("Failed to send message for execution:", exec.id);
            await requeueExecution(exec, supabase);
            continue;
          }
        }

        await advanceToNextStep(exec, currentStep, lead, supabase, supabaseUrl, supabaseKey, executionAccountId);
        processed++;
      } catch (stepErr) {
        console.error("Error processing execution:", exec.id, stepErr);
        if (claimed) {
          try {
            await requeueExecution(exec, supabase);
          } catch (requeueErr) {
            console.error("Failed to requeue execution:", exec.id, requeueErr);
          }
        }
      }
    }

    const { data: moreReady } = await supabase
      .from("flow_executions")
      .select("next_action_at")
      .in("status", READY_STATUSES)
      .order("next_action_at")
      .limit(1);

    if (moreReady && moreReady.length > 0) {
      const nextAt = new Date(moreReady[0].next_action_at).getTime();
      const nowMs = Date.now();
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
    const message = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function claimExecution(exec: any, supabase: any): Promise<boolean> {
  const attempts = (exec.metadata?.send_attempts || 0) + 1;

  if (attempts > 5) {
    console.error("Max retry attempts reached for execution:", exec.id);
    await supabase.from("flow_executions").update({
      status: "failed",
      updated_at: new Date().toISOString(),
    }).eq("id", exec.id);
    return false;
  }

  const { data: claimed, error } = await supabase
    .from("flow_executions")
    .update({
      status: "running",
      metadata: {
        ...exec.metadata,
        send_attempts: attempts,
        last_claimed_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", exec.id)
    .eq("status", exec.status)
    .eq("current_step_id", exec.current_step_id)
    .select("id")
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!claimed) {
    console.log("Execution already claimed or moved:", exec.id);
    return false;
  }

  return true;
}

async function requeueExecution(exec: any, supabase: any) {
  await supabase.from("flow_executions").update({
    status: exec.status,
    next_action_at: new Date(Date.now() + RETRY_DELAY_MS).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", exec.id);
}

async function sendStepMessage(
  step: any,
  lead: any,
  supabase: any,
  supabaseUrl: string,
  supabaseKey: string,
  metadata?: any,
  accountId?: string | null,
): Promise<boolean> {
  const body: any = { phone: lead.phone, lead_id: lead.id };
  if (accountId) body.account_id = accountId;

  const firstName = (lead.name || "").split(" ")[0];
  const codigo = metadata?.codigo || "";
  let expectedLogContent: string | null = null;

  if (step.step_type === "cta_url") {
    const buttons = Array.isArray(step.buttons) ? step.buttons : [];
    const ctaBtn = buttons[0];
    const msgText = (step.custom_message || "Acesse o link abaixo:")
      .replace(/\{nome\}/g, firstName)
      .replace(/\{codigo\}/g, codigo)
      .replace(/\{\{\d+\}\}/g, firstName);

    body.message = msgText;
    expectedLogContent = `🔗 ${msgText}`;

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
    expectedLogContent = `🔘 ${msgText}`;
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
      expectedLogContent = template.content || `📋 Template: ${template.template_name}`;
    } else if (template) {
      body.message = template.content;
      expectedLogContent = template.content;
    }
  } else if (step.custom_message) {
    body.message = step.custom_message
      .replace(/\{nome\}/g, firstName)
      .replace(/\{codigo\}/g, codigo)
      .replace(/\{\{\d+\}\}/g, firstName);
    expectedLogContent = body.message;
  }

  if (!body.message && !body.template_name && !body.interactive_buttons && !body.cta_url) {
    console.error("No message to send for step:", step.id);
    return false;
  }

  if (expectedLogContent) {
    const windowStart = new Date(Date.now() - DUPLICATE_SEND_WINDOW_MS).toISOString();
    const { data: recentDuplicate, error: duplicateError } = await supabase
      .from("chat_messages")
      .select("id, created_at")
      .eq("lead_id", lead.id)
      .eq("direction", "outbound")
      .eq("content", expectedLogContent)
      .gte("created_at", windowStart)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (duplicateError) {
      console.error("Duplicate check failed:", duplicateError);
    }

    if (recentDuplicate) {
      console.log("Skipping duplicate flow send:", step.id, lead.id, recentDuplicate.id);
      return true;
    }
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
  exec: any,
  currentStep: any,
  lead: any,
  supabase: any,
  supabaseUrl: string,
  supabaseKey: string,
  accountId?: string | null,
) {
  let nextStep: any = null;

  const { data: childSteps } = await supabase
    .from("flow_steps")
    .select("*")
    .eq("flow_id", exec.flow_id)
    .eq("parent_step_id", currentStep.id)
    .order("step_order");

  if (childSteps && childSteps.length > 0) {
    if (childSteps.length === 1) {
      nextStep = childSteps[0];
    } else {
      const hasConditionalBranches = childSteps.some((step: any) => step.step_type === "condition");

      if (currentStep.step_type === "interactive_buttons" || hasConditionalBranches) {
        await supabase.from("flow_executions").update({
          current_step_id: currentStep.id,
          status: "waiting_reply",
          updated_at: new Date().toISOString(),
        }).eq("id", exec.id);
        return;
      }
      nextStep = childSteps[0];
    }
  } else {
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
    await supabase.from("flow_executions").update({
      status: "completed",
      updated_at: new Date().toISOString(),
    }).eq("id", exec.id);
    return;
  }

  if (nextStep.step_type === "delay") {
    await supabase.from("flow_executions").update({
      current_step_id: nextStep.id,
      status: "waiting_delay",
      next_action_at: new Date(Date.now() + nextStep.delay_minutes * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", exec.id);
  } else if (nextStep.step_type === "no_response") {
    const timeoutMin = nextStep.timeout_minutes || 10;
    await supabase.from("flow_executions").update({
      current_step_id: nextStep.id,
      status: "waiting_no_response",
      next_action_at: new Date(Date.now() + timeoutMin * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", exec.id);
  } else if (nextStep.step_type === "condition") {
    await supabase.from("flow_executions").update({
      current_step_id: nextStep.id,
      status: "waiting_reply",
      updated_at: new Date().toISOString(),
    }).eq("id", exec.id);
  } else if (
    nextStep.step_type === "message" ||
    nextStep.step_type === "interactive_buttons" ||
    nextStep.step_type === "cta_url" ||
    nextStep.step_type === "blacklist"
  ) {
    await supabase.from("flow_executions").update({
      current_step_id: nextStep.id,
      status: "waiting_delay",
      next_action_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", exec.id);
  }
}
