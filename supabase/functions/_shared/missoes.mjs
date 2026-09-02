// Missões e conquistas.
//
// Avaliadas na leitura, a partir dos números que o painel já calcula. Sem
// tabela de progresso e sem cron: guardar o progresso criaria uma segunda
// verdade que precisa ser mantida em dia, e uma conquista que aparece
// desbloqueada com o número já não batendo é pior que nenhuma.
//
// A perda é real e conhecida: sem registro não há "desbloqueada em tal dia", e
// uma conquista some se o número cair. Para meta mensal isso é o certo — o mês
// ainda não fechou. Para as históricas o número só cresce, então não somem.

export const RARIDADES = {
  comum: { rotulo: "Comum", cor: "#64748b" },
  raro: { rotulo: "Raro", cor: "#3b82f6" },
  epico: { rotulo: "Épico", cor: "#a855f7" },
  lendario: { rotulo: "Lendário", cor: "#eab308" },
};

/** Quantas vendas antes de uma porcentagem significar alguma coisa. */
const VOLUME_MINIMO = 10;

/**
 * Cada missão devolve { feito, progresso } — progresso de 0 a 1, ou null
 * quando a missão não se aplica ao caso (ROI sem investimento, por exemplo).
 * Null não é zero: "não dá para medir" e "medi e deu zero" são coisas
 * diferentes, e mostrar 0% para quem não recebeu verba seria mentira.
 */
const alvo = (valor, meta) => ({
  feito: valor >= meta,
  progresso: meta > 0 ? Math.min(1, Math.max(0, valor / meta)) : null,
});

export const MISSOES = [
  {
    id: "primeira_venda",
    nome: "Primeira Venda",
    desc: "Feche pelo menos uma venda no período.",
    raridade: "comum",
    avalia: (d) => alvo(d.vendas, 1),
  },
  {
    id: "10k",
    nome: "10k no Mês",
    desc: "Fature R$ 10.000 líquidos no período.",
    raridade: "raro",
    avalia: (d) => alvo(d.lucro, 10000),
  },
  {
    id: "50k",
    nome: "50k no Mês",
    desc: "Fature R$ 50.000 líquidos no período.",
    raridade: "epico",
    avalia: (d) => alvo(d.lucro, 50000),
  },
  {
    id: "100k",
    nome: "100k no Mês",
    desc: "Fature R$ 100.000 líquidos no período.",
    raridade: "lendario",
    avalia: (d) => alvo(d.lucro, 100000),
  },
  {
    id: "maquina",
    nome: "Máquina de Vendas",
    desc: "Feche 50 vendas no período.",
    raridade: "raro",
    avalia: (d) => alvo(d.vendas, 50),
  },
  {
    id: "olho_clinico",
    nome: "Olho Clínico",
    desc: "Mantenha ROI acima de 3x no período.",
    raridade: "raro",
    // Sem investimento não existe retorno sobre investimento: a missão não se
    // aplica, e marcá-la como não cumprida puniria quem nunca teve verba.
    avalia: (d) => (d.roi === null ? { feito: false, progresso: null } : alvo(d.roi, 3)),
  },
  {
    id: "mestre_roi",
    nome: "Mestre do ROI",
    desc: "Mantenha ROI acima de 5x no período.",
    raridade: "lendario",
    avalia: (d) => (d.roi === null ? { feito: false, progresso: null } : alvo(d.roi, 5)),
  },
  {
    id: "escudo",
    nome: "Escudo de Ouro",
    desc: `Taxa de reembolso abaixo de 2% (mínimo ${VOLUME_MINIMO} vendas).`,
    raridade: "epico",
    avalia: (d) => {
      // Com poucas vendas, 0% de reembolso não é mérito — é falta de amostra.
      if (d.vendas < VOLUME_MINIMO) return { feito: false, progresso: null };
      const taxa = d.faturamento > 0 ? d.reembolsos / d.faturamento : 0;
      return { feito: taxa < 0.02, progresso: taxa < 0.02 ? 1 : 0 };
    },
  },
  {
    id: "impecavel",
    nome: "Semana Impecável",
    desc: `Nenhum reembolso no período (mínimo ${VOLUME_MINIMO} vendas).`,
    raridade: "raro",
    avalia: (d) =>
      d.vendas < VOLUME_MINIMO
        ? { feito: false, progresso: null }
        : { feito: d.reembolsos === 0, progresso: d.reembolsos === 0 ? 1 : 0 },
  },
  {
    id: "meta_batida",
    nome: "Meta Batida",
    desc: "Alcance a meta individual do período.",
    raridade: "epico",
    avalia: (d) =>
      !d.meta || d.meta <= 0 ? { feito: false, progresso: null } : alvo(d.faturamento, d.meta),
  },
  {
    id: "meio_milhao",
    nome: "Meio Milhão",
    desc: "Acumule R$ 500.000 em vendas, somando todo o histórico.",
    raridade: "epico",
    avalia: (d) => alvo(d.acumulado, 500000),
  },
  {
    id: "milhao",
    nome: "O Milhão",
    desc: "Acumule R$ 1.000.000 em vendas, somando todo o histórico.",
    raridade: "lendario",
    avalia: (d) => alvo(d.acumulado, 1000000),
  },
];

/** Avalia todas as missões para um vendedor. */
export function avaliarMissoes(dados) {
  const d = {
    vendas: 0, faturamento: 0, lucro: 0, reembolsos: 0,
    acumulado: 0, roi: null, meta: 0, ...dados,
  };
  return MISSOES.map((m) => ({ ...m, ...m.avalia(d) }));
}
