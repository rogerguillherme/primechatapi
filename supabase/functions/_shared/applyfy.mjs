// Leitura de transação da ApplyFy.
//
// A resposta de checkout raramente tem um formato só: campos mudam de nome
// entre versões e entre eventos. Este projeto já lida com isso no
// hubla-webhook e no custom-webhook, tentando vários nomes para o mesmo dado.
// Aqui é a mesma abordagem — e é o que permite a integração sobreviver a um
// campo renomeado sem virar incidente.

const primeiro = (...vs) => vs.find((v) => v !== undefined && v !== null && v !== "");

/** Valor em reais. Muitas plataformas mandam centavos; o nome do campo denuncia. */
export function valorDaTransacao(t) {
  const emCentavos = primeiro(t?.amount_cents, t?.amountInCents, t?.value_cents);
  if (emCentavos != null) return Math.round(Number(emCentavos)) / 100;

  const bruto = primeiro(t?.amount, t?.value, t?.total, t?.valor, t?.price);
  const n = Number(String(bruto ?? "").toString().replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Status da ApplyFy no vocabulário do app.
 *
 * Desconhecido devolve null e a transação é IGNORADA, não gravada como
 * aprovada: inventar aprovação infla o faturamento e a comissão sai sobre
 * dinheiro que talvez não exista.
 */
export function statusDaTransacao(t) {
  const s = String(primeiro(t?.status, t?.situacao, t?.state) || "").toLowerCase();
  if (["paid", "approved", "aprovado", "aprovada", "pago", "completed", "succeeded"].includes(s)) {
    return "approved";
  }
  if (["refunded", "reembolsado", "reembolsada", "estornado", "chargeback"].includes(s)) {
    return "refunded";
  }
  if (["pending", "pendente", "waiting", "aguardando", "processing"].includes(s)) return "pending";
  if (["canceled", "cancelled", "cancelado", "cancelada", "expired", "refused", "recusado"].includes(s)) {
    return "cancelled";
  }
  return null;
}

/** Normaliza uma transação para o formato que `orders` espera. */
export function mapearTransacao(t) {
  const id = primeiro(t?.id, t?.transaction_id, t?.transactionId, t?.code, t?.reference);
  const status = statusDaTransacao(t);
  if (!id || !status) return null;

  const cliente = t?.customer || t?.client || t?.buyer || {};
  const criadoEm = primeiro(t?.created_at, t?.createdAt, t?.date, t?.paid_at, t?.data);

  return {
    externalId: String(id),
    status,
    amount: valorDaTransacao(t),
    method: String(primeiro(t?.payment_method, t?.paymentMethod, t?.method, t?.tipo) || "")
      .toLowerCase() || null,
    createdAt: criadoEm ? new Date(criadoEm).toISOString() : null,
    phone: String(primeiro(cliente.phone, cliente.telefone, cliente.celular, t?.phone) || ""),
    name: primeiro(cliente.name, cliente.full_name, cliente.nome, t?.name) || null,
    email: primeiro(cliente.email, t?.email) || null,
  };
}

/** A lista de transações pode vir na raiz ou embrulhada; aceita as duas. */
export function listaDeTransacoes(resposta) {
  if (Array.isArray(resposta)) return resposta;
  return (
    resposta?.data ||
    resposta?.transactions ||
    resposta?.items ||
    resposta?.results ||
    []
  );
}
