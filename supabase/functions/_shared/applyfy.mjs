// Leitura de transação da ApplyFy.
//
// A API tem UMA rota de consulta: busca por id, uma transação por vez. Não há
// listagem, e a própria documentação pede para não fazer polling — o caminho
// para receber venda é o webhook. Portanto isto aqui não serve para descobrir
// vendas novas; serve para RECONFERIR as que já conhecemos e cujo status pode
// ter mudado sem o webhook chegar.

/** Status da ApplyFy no vocabulário do app. */
const STATUS = {
  COMPLETED: "approved",
  PENDING: "pending",
  FAILED: "cancelled",
  REFUNDED: "refunded",
  CHARGED_BACK: "chargeback",
};

const METODO = {
  PIX: "pix",
  CREDIT_CARD: "cartao",
  BOLETO: "boleto",
  TED: "ted",
  CRYPTO: "cripto",
  CASH_ON_DELIVERY: "na_entrega",
};

/**
 * Normaliza a transação para o formato de `orders`.
 *
 * Devolve null quando o status não é reconhecido. Status novo tratado como
 * aprovado infla faturamento e comissão sai sobre dinheiro que talvez não
 * exista — melhor ignorar e aparecer no contador de "não reconhecidas".
 */
export function mapearTransacao(t) {
  const status = STATUS[String(t?.status || "").toUpperCase()];
  if (!t?.id || !status) return null;

  // `chargeAmount` é o que o CLIENTE pagou; `amount` é o que sobra para o
  // produtor, já sem as taxas do checkout. Faturamento é o que o cliente
  // pagou — usar o líquido aqui esconderia a taxa e, pior, a base de comissão
  // seria descontada duas vezes: uma pela API e outra pela configuração.
  const bruto = Number(t.chargeAmount ?? t.amount ?? 0);
  const liquido = Number(t.amount ?? 0);

  // Câmbio: para moeda diferente de BRL, o valor precisa ser multiplicado.
  const cambio = Number(t.exchangeRate) || 1;

  return {
    externalId: String(t.id),
    status,
    amount: Math.round(bruto * cambio * 100) / 100,
    // ponytail: a taxa real está disponível (bruto − líquido) e é melhor que a
    // configurada. Guardar exige coluna em orders; enquanto não houver, a
    // regra de taxa por plataforma cobre.
    taxaReal: Math.round((bruto - liquido) * cambio * 100) / 100,
    method: METODO[String(t.paymentMethod || "").toUpperCase()] || null,
    createdAt: t.payedAt || t.createdAt || null,
    recorrente: String(t.purchaseType || "ONCE").toUpperCase() === "RECURRING",
  };
}
