import { supabase } from "@/integrations/supabase/client";

/**
 * Inicia um fluxo já criado para um lead específico.
 *
 * Reproduz a mesma sequência usada no disparo manual da tela de API:
 * 1. localiza a primeira etapa do fluxo (raiz, com fallback para a menor ordem);
 * 2. cancela execuções ativas do lead para evitar dois fluxos concorrentes;
 * 3. cria a execução com o status/agendamento correto para o tipo da etapa;
 * 4. acorda o processador de fluxos.
 *
 * Lança erro com mensagem legível — o chamador exibe no toast.
 */
export async function startFlowForLead(params: {
  flowId: string;
  leadId: string;
  accountId?: string | null;
  codigo?: string;
}): Promise<void> {
  const { flowId, leadId, accountId = null, codigo = "" } = params;

  if (!flowId) throw new Error("Fluxo não informado");
  if (!leadId) throw new Error("Lead não informado");

  const { data: rootSteps, error: rootStepError } = await supabase
    .from("flow_steps")
    .select("*")
    .eq("flow_id", flowId)
    .is("parent_step_id", null)
    .order("step_order")
    .limit(1);

  if (rootStepError) throw new Error(`Erro ao carregar etapas do fluxo: ${rootStepError.message}`);

  let firstStep: any = rootSteps?.[0];

  if (!firstStep) {
    const { data: anySteps, error: anyStepError } = await supabase
      .from("flow_steps")
      .select("*")
      .eq("flow_id", flowId)
      .order("step_order")
      .limit(1);
    if (anyStepError) throw new Error(`Erro ao carregar etapas do fluxo: ${anyStepError.message}`);
    firstStep = anySteps?.[0];
  }

  if (!firstStep) {
    throw new Error("Fluxo sem etapas. Abra o Flow Builder e salve o fluxo novamente.");
  }

  const status =
    firstStep.step_type === "no_response"
      ? "waiting_no_response"
      : firstStep.step_type === "condition"
        ? "waiting_reply"
        : "waiting_delay";

  const baseMs = Date.now();
  const nextActionAt =
    firstStep.step_type === "delay"
      ? new Date(baseMs + ((firstStep.delay_minutes || 0) * 60 + (firstStep.delay_min_seconds || 0)) * 1000).toISOString()
      : firstStep.step_type === "no_response"
        ? new Date(baseMs + (firstStep.timeout_minutes || 10) * 60 * 1000).toISOString()
        : new Date(baseMs).toISOString();

  await supabase
    .from("flow_executions")
    .update({ status: "cancelled" })
    .eq("lead_id", leadId)
    // `paused` entra aqui: senão iniciar outro fluxo deixaria o pausado vivo,
    // e ele voltaria a disparar no meio do novo quando alguém retomasse.
    .in("status", ["running", "waiting_delay", "waiting_reply", "waiting_no_response", "paused"]);

  const { error: insertError } = await supabase.from("flow_executions").insert({
    flow_id: flowId,
    lead_id: leadId,
    current_step_id: firstStep.id,
    status,
    next_action_at: nextActionAt,
    metadata: { codigo, account_id: accountId },
  });

  if (insertError) throw new Error(`Erro ao iniciar execução do fluxo: ${insertError.message}`);

  // Dispara o processador sem bloquear a UI — o cron também o acorda periodicamente.
  supabase.functions.invoke("flow-processor", { body: { auto: true } }).catch(() => {});
}
