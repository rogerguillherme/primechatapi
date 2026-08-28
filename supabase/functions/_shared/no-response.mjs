// Decisão do passo "Sem Resposta", isolada do banco para poder ser testada.
//
// Vive aqui, e não dentro do flow-processor, porque o erro que esta regra
// esconde é invisível em produção: o fluxo continua rodando, só que ignorando
// a condição que o operador configurou. Foi assim que um lead que respondeu
// com áudio recebeu o resto do pitch.

/**
 * @param conditions lista de condições do passo, na ordem configurada
 * @param ctx.elapsedMin minutos desde que o passo começou a esperar
 * @param ctx.repliedAfterStart o lead mandou qualquer mensagem depois disso
 * @param ctx.loadLabels () => Promise<string[]>, chamado só se necessário
 */
export async function decideNoResponse(conditions, ctx) {
  const lista = Array.isArray(conditions) ? conditions : [];

  // Passo sem condição nenhuma mantém o comportamento antigo: segue em frente.
  if (lista.length === 0) return { kind: "advance", branchKey: null };

  const { elapsedMin, repliedAfterStart } = ctx;
  let labels = null;
  const carregarLabels = async () => {
    if (labels === null) labels = (await ctx.loadLabels()) || [];
    return labels;
  };

  for (const cond of lista) {
    const espera = Math.max(0, Number(cond?.timeout_minutes) || 0);
    const esperou = elapsedMin >= espera;

    switch (cond?.type) {
      case "replied_late":
        if (esperou && repliedAfterStart) return { kind: "advance", branchKey: cond.key ?? null };
        break;
      case "has_label": {
        if (!esperou) break;
        const l = await carregarLabels();
        if (cond.label_id && l.includes(cond.label_id)) {
          return { kind: "advance", branchKey: cond.key ?? null };
        }
        break;
      }
      case "no_label": {
        if (!esperou) break;
        const l = await carregarLabels();
        if (cond.label_id && !l.includes(cond.label_id)) {
          return { kind: "advance", branchKey: cond.key ?? null };
        }
        break;
      }
      case "else":
        if (esperou) return { kind: "advance", branchKey: cond.key ?? null };
        break;
      case "timeout":
      default:
        // Só continua quem NÃO respondeu dentro do tempo.
        if (esperou && !repliedAfterStart) return { kind: "advance", branchKey: cond.key ?? null };
        break;
    }
  }

  // Ainda há condição com espera maior: aguarda em vez de decidir agora.
  const proxima = lista
    .map((c) => Math.max(0, Number(c?.timeout_minutes) || 0))
    .filter((min) => min > elapsedMin)
    .sort((a, b) => a - b)[0];

  if (proxima !== undefined) return { kind: "requeue", waitMin: proxima };

  // Havia condições e NENHUMA foi atendida. Aqui não se avança: seguir seria
  // ignorar exatamente a regra que o operador configurou.
  return { kind: "stop", reason: "nenhuma_condicao_atendida" };
}
