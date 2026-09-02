// Motor do Prime Metrics: elo, comissão e progresso.
//
// Vive fora da tela porque é onde o produto acerta ou erra. Um elo calculado
// errado não quebra nada visivelmente — a página abre, os cartões aparecem, e
// o vendedor recebe a comissão errada. É o mesmo tipo de falha silenciosa que
// já custou caro no resto deste app, e aqui envolve o dinheiro de terceiros.
//
// O plano registra uma armadilha do sistema avaliado: indicadores viravam
// "0.00x" ou "100.00x" quando o denominador era zero. Toda divisão aqui trata
// o zero explicitamente.

/** Ordena os elos do menor corte para o maior, sem alterar o array recebido. */
function ordenados(tiers) {
  return [...(tiers || [])].sort((a, b) => Number(a.min_value) - Number(b.min_value));
}

/**
 * O elo atual: o de maior corte que o valor já alcançou.
 * Abaixo do primeiro corte não há elo — e isso é diferente de "elo zerado".
 */
export function eloAtual(tiers, valor) {
  const v = Number(valor) || 0;
  const lista = ordenados(tiers);
  let atual = null;
  for (const t of lista) {
    if (v >= Number(t.min_value)) atual = t;
    else break;
  }
  return atual;
}

/** O próximo elo e quanto falta para ele. Null quando já está no topo. */
export function proximoElo(tiers, valor) {
  const v = Number(valor) || 0;
  const lista = ordenados(tiers);
  const proximo = lista.find((t) => Number(t.min_value) > v);
  if (!proximo) return null;
  return { tier: proximo, falta: Number(proximo.min_value) - v };
}

/**
 * Progresso dentro do elo atual, de 0 a 1.
 *
 * Entre o corte do elo atual e o do próximo — não do zero absoluto, senão um
 * vendedor recém-promovido apareceria quase cheio na barra do elo novo.
 */
export function progressoNoElo(tiers, valor) {
  const v = Number(valor) || 0;
  const atual = eloAtual(tiers, valor);
  const prox = proximoElo(tiers, valor);
  if (!prox) return 1;

  const piso = atual ? Number(atual.min_value) : 0;
  const teto = Number(prox.tier.min_value);
  const faixa = teto - piso;
  if (faixa <= 0) return 1;
  return Math.min(1, Math.max(0, (v - piso) / faixa));
}

/** Comissão do valor no elo alcançado. Sem elo, sem comissão. */
export function comissao(valor, tiers) {
  const v = Number(valor) || 0;
  const elo = eloAtual(tiers, v);
  if (!elo) return 0;
  const pct = Number(elo.commission_pct) || 0;
  return Math.round(v * pct) / 100;
}

/**
 * Progresso de uma meta, de 0 a 1.
 *
 * Meta zero não é "100% atingida" nem divisão por zero: é meta não definida, e
 * a tela precisa saber a diferença para não comemorar sozinha.
 */
export function progressoMeta(valor, alvo) {
  const a = Number(alvo) || 0;
  if (a <= 0) return null;
  return Math.min(1, Math.max(0, (Number(valor) || 0) / a));
}

/**
 * ROAS: quanto voltou para cada real gasto em anúncio.
 *
 * Gasto zero devolve null, NÃO "100.00x" nem "0.00x". É a armadilha que o
 * plano registra do sistema avaliado, e ela não é cosmética: um vendedor que
 * não recebeu tráfego apareceria como o mais eficiente da equipe, e o ranking
 * inteiro deixaria de significar alguma coisa.
 *
 * Sem gasto não existe retorno SOBRE gasto. A resposta certa é "não se aplica",
 * e cabe à tela dizer isso em vez de inventar um número.
 */
export function roas(faturamento, gastoAds) {
  const g = Number(gastoAds) || 0;
  if (g <= 0) return null;
  return (Number(faturamento) || 0) / g;
}

/**
 * ROI: o retorno acima do que foi gasto, como proporção do gasto.
 *
 * Negativo é resultado legítimo — significa que se gastou mais do que voltou, e
 * esconder isso seria pior. O que não é legítimo é dividir por zero.
 */
export function roi(faturamento, gastoAds) {
  const g = Number(gastoAds) || 0;
  if (g <= 0) return null;
  return ((Number(faturamento) || 0) - g) / g;
}

/**
 * A base sobre a qual se comissiona.
 *
 * Não é o faturamento cru. A plataforma de checkout retém a taxa dela antes de
 * o dinheiro chegar, e reembolso é dinheiro que voltou. Comissionar sobre o
 * bruto paga o vendedor por dinheiro que a empresa não recebeu — e isso só
 * aparece no fim do mês, no extrato, quando a comissão já foi combinada.
 *
 * A taxa incide sobre o que de fato ficou, ou seja depois do reembolso: o
 * checkout devolve a taxa proporcional do que foi estornado.
 */
export function baseComissao(faturamento, reembolsos = 0, taxaPct = 0) {
  const liquido = (Number(faturamento) || 0) - (Number(reembolsos) || 0);
  if (liquido <= 0) return 0;
  const taxa = Math.min(100, Math.max(0, Number(taxaPct) || 0));
  return Math.round(liquido * (1 - taxa / 100) * 100) / 100;
}

/**
 * Comissão sobre a base, no percentual do elo alcançado.
 *
 * Sem elo alcançado usa o percentual padrão da empresa em vez de zerar: uma
 * equipe que ainda não cadastrou elos precisa ver comissão, senão a tela de
 * comissionados nasce inútil e ninguém volta nela.
 */
export function comissaoSobreBase(base, tiers, faturamento, pctPadrao = 0) {
  const b = Number(base) || 0;
  if (b <= 0) return 0;
  const elo = eloAtual(tiers, Number(faturamento) || 0);
  const pct = elo ? Number(elo.commission_pct) || 0 : Number(pctPadrao) || 0;
  return Math.round(b * pct) / 100;
}
