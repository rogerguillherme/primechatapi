// Run: node supabase/functions/_shared/test_applyfy.mjs
import assert from "node:assert/strict";
import { valorDaTransacao, statusDaTransacao, mapearTransacao, listaDeTransacoes } from "./applyfy.mjs";

// ── valor: centavos denunciados pelo nome do campo ──
assert.equal(valorDaTransacao({ amount_cents: 49700 }), 497);
assert.equal(valorDaTransacao({ amountInCents: 4999 }), 49.99);
assert.equal(valorDaTransacao({ amount: 497.5 }), 497.5);
assert.equal(valorDaTransacao({ valor: "1.234,56".replace(".", "") }), 1234.56);
assert.equal(valorDaTransacao({}), 0);

// ── status ──
assert.equal(statusDaTransacao({ status: "paid" }), "approved");
assert.equal(statusDaTransacao({ status: "APROVADO" }), "approved");
assert.equal(statusDaTransacao({ status: "refunded" }), "refunded");
assert.equal(statusDaTransacao({ status: "pending" }), "pending");
assert.equal(statusDaTransacao({ status: "recusado" }), "cancelled");
// Status desconhecido NÃO vira aprovado: inflaria faturamento e comissão.
assert.equal(statusDaTransacao({ status: "coisa_nova" }), null);
assert.equal(statusDaTransacao({}), null);

// ── mapeamento ──
const t = mapearTransacao({
  id: "tx_1", status: "paid", amount_cents: 19700,
  payment_method: "PIX", created_at: "2026-09-01T10:00:00Z",
  customer: { name: "Ana", phone: "5511999998888", email: "a@b.com" },
});
assert.equal(t.externalId, "tx_1");
assert.equal(t.amount, 197);
assert.equal(t.method, "pix");
assert.equal(t.phone, "5511999998888");

// Sem id ou sem status reconhecido, a transação é descartada em vez de virar
// venda torta.
assert.equal(mapearTransacao({ status: "paid" }), null);
assert.equal(mapearTransacao({ id: "x", status: "???" }), null);

// ── envelope da lista ──
assert.equal(listaDeTransacoes([{ id: 1 }]).length, 1);
assert.equal(listaDeTransacoes({ data: [{ id: 1 }, { id: 2 }] }).length, 2);
assert.equal(listaDeTransacoes({ transactions: [{ id: 1 }] }).length, 1);
assert.equal(listaDeTransacoes({}).length, 0);

console.log("applyfy: all assertions passed");
