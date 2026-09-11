// Para a sequência de nutrição de um lead quando a compra é aprovada.
//
// Não existe gatilho "tag adicionada -> para o fluxo" no Prime, e nada cancela
// um fluxo em andamento quando entra uma compra. Isto fecha esse buraco: os
// webhooks de venda (custom-webhook, kiwify-webhook) chamam esta função no
// caminho de compra aprovada — mas só para leads identificados como vindos do
// funil zerolipedema (ver checagem no chamador), porque cancelar qualquer
// execução em andamento de qualquer lead que comprar em qualquer conta
// quebraria fluxo de pós-venda de outras contas no mesmo CRM.

// Status que contam como "execução em andamento". Mesma lista usada pelo
// dedupe do custom-webhook.
const EM_ANDAMENTO = [
  "running",
  "waiting_delay",
  "waiting_reply",
  "scheduled",
  "waiting_no_response",
];

/**
 * Cancela as execuções de fluxo em andamento do lead.
 *
 * ponytail: cancela TODAS as execuções em andamento do lead, sem escopar por
 * flow_id. Suficiente para o funil zerolipedema (um lead = uma sequência de
 * cada vez). Se um lead puder estar em duas sequências simultâneas e você
 * quiser parar só a de nutrição, passe a filtrar por flow_id.
 *
 * @returns número de execuções canceladas
 */
export async function pararNutricao(admin, leadId, motivo = "comprou") {
  if (!leadId) return 0;

  // Lê antes para mesclar o metadata de cada execução (um bulk update não
  // consegue preservar o metadata linha a linha). Na prática são 0-1 linhas.
  const { data: execs, error } = await admin
    .from("flow_executions")
    .select("id, metadata")
    .eq("lead_id", leadId)
    .in("status", EM_ANDAMENTO);

  if (error) {
    console.error("pararNutricao: falha ao listar execuções", error);
    return 0;
  }
  if (!execs || execs.length === 0) return 0;

  let canceladas = 0;
  for (const e of execs) {
    const { error: upErr } = await admin
      .from("flow_executions")
      .update({
        status: "cancelled",
        updated_at: new Date().toISOString(),
        metadata: { ...(e.metadata || {}), stop_reason: motivo },
      })
      .eq("id", e.id);
    if (upErr) {
      console.error(`pararNutricao: falha ao cancelar execução ${e.id}`, upErr);
    } else {
      canceladas++;
    }
  }
  console.log(`pararNutricao: lead ${leadId} — ${canceladas} execução(ões) cancelada(s) (${motivo})`);
  return canceladas;
}
