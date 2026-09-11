// Lógica pura do webhook da Kiwify — extração do payload, mapa de status,
// assinatura. Fora do handler para ser coberta por test_kiwify.mjs em node.
//
// Shape da Kiwify:
//   root: order_id, order_status (paid|waiting_payment|refused|refunded|chargedback),
//         webhook_event_type (order_approved|pix_created|order_refunded|chargeback|subscription_*),
//         payment_method
//   Customer: full_name, first_name, last_name, email, mobile, CPF
//   Product:  product_id, product_name
//   Commissions: charge_amount (CENTAVOS)
//   Assinatura: ?signature=<hmac-sha1-hex do corpo cru, chave = token da conta>

import { normalizeTypedPhone, phoneVariants } from "./phone.mjs";
import { resolverStatusVenda } from "./venda-status.mjs";

export { phoneVariants };

export async function hmacSha1Hex(rawBody, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function mapKiwifyStatus(orderStatus, eventType) {
  const s = String(orderStatus || "").toLowerCase();
  const e = String(eventType || "").toLowerCase();
  if (s === "paid" || e === "order_approved") return "approved";
  if (s === "refunded" || e === "order_refunded") return "refunded";
  if (s === "chargedback" || e === "chargeback") return "chargeback";
  if (s === "refused") return "cancelled";
  if (s === "waiting_payment" || e === "pix_created") return "pending";
  return resolverStatusVenda({ status: orderStatus, event_type: eventType }, "");
}

export function mapToFlowTrigger(status, paymentMethod) {
  const pm = String(paymentMethod || "").toLowerCase();
  if (status === "approved") return "compra_aprovada";
  if (status === "refunded" || status === "chargeback") return "reembolso";
  if (status === "cancelled") return pm.includes("card") || pm.includes("credit") ? "cartao" : null;
  if (status === "pending" && pm.includes("pix")) return "pix";
  return null;
}

export function extractKiwify(payload) {
  const customer = payload?.Customer || payload?.customer || {};
  const product = payload?.Product || payload?.product || {};
  const commissions = payload?.Commissions || payload?.commissions || {};

  const externalOrderId = String(
    payload?.order_id || payload?.order_ref || payload?.id || payload?.transaction_id || "",
  );

  const buyerName = (
    customer.full_name ||
    [customer.first_name, customer.last_name].filter(Boolean).join(" ") ||
    payload?.full_name ||
    "Sem nome"
  ).trim();

  const buyerEmail = customer.email || payload?.email || null;
  const buyerPhone = normalizeTypedPhone(customer.mobile || customer.phone || payload?.phone || "");

  const rawCpf = customer.CPF || customer.cpf || payload?.cpf || "";
  const buyerCpf = rawCpf ? String(rawCpf).replace(/\D/g, "") : null;

  const productName = product.product_name || product.name || payload?.product_name || "";
  const kiwifyProductId = product.product_id || product.id || null;

  const cents = Number(commissions.charge_amount ?? payload?.charge_amount ?? 0);
  const amount = Number.isFinite(cents) && cents > 0 ? cents / 100 : 0;

  const paymentMethod = payload?.payment_method || null;
  const eventType = payload?.webhook_event_type || payload?.event_type || "";
  const status = mapKiwifyStatus(payload?.order_status || "", eventType);

  return {
    externalOrderId, buyerName, buyerEmail, buyerPhone, buyerCpf,
    productName, kiwifyProductId, amount, paymentMethod, status, eventType,
  };
}
