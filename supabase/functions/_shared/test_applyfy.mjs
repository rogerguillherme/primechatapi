// Run: node supabase/functions/_shared/test_applyfy.mjs
import assert from "node:assert/strict";
import { mapearTransacao } from "./applyfy.mjs";

const base = {
  id: "tx_1", status: "COMPLETED", paymentMethod: "PIX",
  chargeAmount: 200, amount: 190, exchangeRate: 1,
  createdAt: "2026-09-01T10:00:00Z",
};

// ── faturamento é o que o CLIENTE pagou, não o que sobrou ──
// Usar o líquido esconderia a taxa e faria a base de comissão ser descontada
// duas vezes: uma pela API, outra pela configuração de taxas.
const t = mapearTransacao(base);
assert.equal(t.amount, 200);
assert.equal(t.taxaReal, 10);
assert.equal(t.status, "approved");
assert.equal(t.method, "pix");

// ── todos os status do enum viram algo conhecido ──
assert.equal(mapearTransacao({ ...base, status: "PENDING" }).status, "pending");
assert.equal(mapearTransacao({ ...base, status: "REFUNDED" }).status, "refunded");
assert.equal(mapearTransacao({ ...base, status: "CHARGED_BACK" }).status, "chargeback");
assert.equal(mapearTransacao({ ...base, status: "FAILED" }).status, "cancelled");

// Status novo NÃO vira aprovado.
assert.equal(mapearTransacao({ ...base, status: "SOMETHING_NEW" }), null);
assert.equal(mapearTransacao({ ...base, id: null }), null);

// ── câmbio: moeda estrangeira precisa ser convertida ──
const usd = mapearTransacao({ ...base, chargeAmount: 100, amount: 95, exchangeRate: 5.4 });
assert.equal(usd.amount, 540);
assert.equal(usd.taxaReal, 27);

// Sem chargeAmount, o amount é o que há.
assert.equal(mapearTransacao({ ...base, chargeAmount: undefined }).amount, 190);

// Cartão e assinatura são reconhecidos.
assert.equal(mapearTransacao({ ...base, paymentMethod: "CREDIT_CARD" }).method, "cartao");
assert.equal(mapearTransacao({ ...base, purchaseType: "RECURRING" }).recorrente, true);

console.log("applyfy: all assertions passed");
