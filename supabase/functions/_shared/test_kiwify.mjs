// Self-check da lógica pura do webhook da Kiwify.
// Run: node supabase/functions/_shared/test_kiwify.mjs
import assert from "node:assert/strict";
import {
  extractKiwify,
  mapKiwifyStatus,
  mapToFlowTrigger,
  hmacSha1Hex,
  timingSafeEqual,
} from "./kiwify.mjs";

// ── mapKiwifyStatus ──
assert.equal(mapKiwifyStatus("paid", "order_approved"), "approved");
assert.equal(mapKiwifyStatus("", "order_approved"), "approved");
assert.equal(mapKiwifyStatus("refunded", ""), "refunded");
assert.equal(mapKiwifyStatus("chargedback", ""), "chargeback", "chargedback != chargeback como string");
assert.equal(mapKiwifyStatus("", "chargeback"), "chargeback");
assert.equal(mapKiwifyStatus("refused", ""), "cancelled");
assert.equal(mapKiwifyStatus("waiting_payment", "pix_created"), "pending");

// ── mapToFlowTrigger ──
assert.equal(mapToFlowTrigger("approved", "pix"), "compra_aprovada");
assert.equal(mapToFlowTrigger("refunded", null), "reembolso");
assert.equal(mapToFlowTrigger("chargeback", null), "reembolso");
assert.equal(mapToFlowTrigger("pending", "pix"), "pix");
assert.equal(mapToFlowTrigger("pending", "credit_card"), null, "pix trigger só para pix");
assert.equal(mapToFlowTrigger("cancelled", "credit_card"), "cartao");
assert.equal(mapToFlowTrigger("cancelled", "pix"), null);

// ── extractKiwify: payload realista da Kiwify ──
const payload = {
  order_id: "abc-123",
  order_status: "paid",
  webhook_event_type: "order_approved",
  payment_method: "pix",
  Customer: {
    full_name: "Maria Silva",
    email: "maria@exemplo.com",
    mobile: "11987654321",   // sem DDI: normalizeTypedPhone gruda o 55
    CPF: "123.456.789-00",
  },
  Product: { product_id: "p1", product_name: "Protocolo Zero Lipedema" },
  Commissions: { charge_amount: 19700 }, // centavos
};
const ex = extractKiwify(payload);
assert.equal(ex.externalOrderId, "abc-123");
assert.equal(ex.buyerName, "Maria Silva");
assert.equal(ex.buyerEmail, "maria@exemplo.com");
assert.equal(ex.buyerPhone, "5511987654321", "telefone BR sem DDI recebe o 55");
assert.equal(ex.buyerCpf, "12345678900", "CPF só dígitos");
assert.equal(ex.productName, "Protocolo Zero Lipedema");
assert.equal(ex.amount, 197, "charge_amount em centavos -> reais");
assert.equal(ex.status, "approved");

// telefone estrangeiro não é corrompido com 55
const exExt = extractKiwify({ order_id: "x", order_status: "paid", Customer: { mobile: "351927092084" } });
assert.equal(exExt.buyerPhone, "351927092084", "número de 12 dígitos fica intacto");

// sem valor -> amount 0 (a venda não é gravada, mas o webhook não quebra)
const exZero = extractKiwify({ order_id: "y", order_status: "waiting_payment", webhook_event_type: "pix_created" });
assert.equal(exZero.amount, 0);
assert.equal(exZero.status, "pending");

// ── assinatura ?signature= ──
const raw = JSON.stringify(payload);
const secret = "token-da-conta-kiwify";
const sig = await hmacSha1Hex(raw, secret);
assert.match(sig, /^[0-9a-f]{40}$/, "hmac-sha1 hex tem 40 chars");
assert.equal(await hmacSha1Hex(raw, secret), sig, "determinística");
assert.notEqual(await hmacSha1Hex(raw + " ", secret), sig, "corpo diferente -> assinatura diferente");
assert.ok(timingSafeEqual(sig, sig));
assert.ok(!timingSafeEqual(sig, sig.slice(0, -1) + "0"));
assert.ok(!timingSafeEqual(sig, "abc"));

console.log("kiwify: all assertions passed");
