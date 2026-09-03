// Status da venda a partir do payload do webhook.
//
// O tipo do endpoint diz o que ele foi CADASTRADO para receber, não o que
// chegou. Quem aponta todos os eventos da plataforma para a mesma URL — que é
// o arranjo mais comum, porque é o mais simples de configurar lá — receberia
// reembolso e estorno gravados como venda aprovada, inflando o faturamento e
// pagando comissão sobre dinheiro devolvido.
//
// Então o payload manda. O tipo do endpoint é só a saída para payload que não
// diz nada sobre status.

/** Palavras que cada plataforma usa. Uma lista, não uma por integração. */
const MAPA = {
  approved: [
    "completed", "paid", "approved", "aprovado", "aprovada", "pago", "paga",
    "succeeded", "success", "payment_succeeded", "invoice.payment_succeeded",
    "purchase.approved", "compra_aprovada", "authorized",
  ],
  refunded: ["refunded", "refund", "reembolsado", "reembolsada", "estornado", "estornada", "reembolso"],
  chargeback: ["charged_back", "chargeback", "charge_back", "contestado"],
  pending: ["pending", "pendente", "waiting", "aguardando", "processing", "em_analise", "analysis"],
  cancelled: [
    "failed", "failure", "canceled", "cancelled", "cancelado", "cancelada",
    "expired", "expirado", "refused", "recusado", "declined", "rejected",
  ],
};

const normalizar = (v) =>
  String(v ?? "").toLowerCase().trim().replace(/[\s-]+/g, "_");

/** Procura um status reconhecível em qualquer um dos campos usuais. */
export function statusDoPayload(payload) {
  const p = payload || {};
  const candidatos = [
    p.status, p.transaction_status, p.transactionStatus, p.payment_status,
    p.paymentStatus, p.situacao, p.state, p.event, p.event_type, p.eventType,
    p.type, p.data?.status, p.transaction?.status, p.event?.type,
  ];

  for (const bruto of candidatos) {
    const v = normalizar(bruto);
    if (!v) continue;
    for (const [alvo, palavras] of Object.entries(MAPA)) {
      // Igualdade antes de "contém": "refunded" não pode casar com uma regra
      // de aprovado só porque a string de evento carrega as duas palavras.
      if (palavras.includes(v)) return alvo;
    }
  }

  // Segunda passada, mais frouxa: nomes de evento compostos como
  // "order.payment.refunded". Reembolso e estorno primeiro, porque são os que
  // custam caro quando lidos como aprovação.
  for (const bruto of candidatos) {
    const v = normalizar(bruto);
    if (!v) continue;
    for (const alvo of ["chargeback", "refunded", "cancelled", "pending", "approved"]) {
      if (MAPA[alvo].some((palavra) => v.includes(palavra))) return alvo;
    }
  }

  return null;
}

/** Tipo do endpoint como último recurso. */
export function statusDoEvento(eventType) {
  switch (eventType) {
    case "compra_aprovada":
    case "pix":
    case "cartao":
      return "approved";
    case "reembolso":
      return "refunded";
    case "cancelamento":
      return "cancelled";
    default:
      return null;
  }
}

/**
 * O status que vale. Null = não é uma venda e nada deve ser gravado —
 * carrinho abandonado registrado como venda inflaria o faturamento com
 * dinheiro que nunca entrou.
 */
export function resolverStatusVenda(payload, eventType) {
  if (eventType === "carrinho_abandonado") return null;
  return statusDoPayload(payload) ?? statusDoEvento(eventType);
}
