// Run: node supabase/functions/_shared/test_venda-status.mjs
import assert from "node:assert/strict";
import { resolverStatusVenda, statusDoPayload } from "./venda-status.mjs";

// ── o caso do Roger: TODOS os eventos apontados para o endpoint de
// "compra aprovada". O payload precisa mandar, senão reembolso vira venda. ──
assert.equal(resolverStatusVenda({ status: "REFUNDED" }, "compra_aprovada"), "refunded");
assert.equal(resolverStatusVenda({ status: "CHARGED_BACK" }, "compra_aprovada"), "chargeback");
assert.equal(resolverStatusVenda({ status: "PENDING" }, "compra_aprovada"), "pending");
assert.equal(resolverStatusVenda({ status: "COMPLETED" }, "compra_aprovada"), "approved");
assert.equal(resolverStatusVenda({ status: "FAILED" }, "compra_aprovada"), "cancelled");

// ── vocabulário de outras plataformas no mesmo endpoint ──
assert.equal(resolverStatusVenda({ status: "paid" }, "compra_aprovada"), "approved");
assert.equal(resolverStatusVenda({ event: "invoice.payment_succeeded" }, "compra_aprovada"), "approved");
assert.equal(resolverStatusVenda({ status: "estornado" }, "compra_aprovada"), "refunded");
assert.equal(resolverStatusVenda({ transaction: { status: "APPROVED" } }, "compra_aprovada"), "approved");

// ── evento composto: "refunded" não pode virar aprovado ──
assert.equal(statusDoPayload({ event: "order.payment.refunded" }), "refunded");
assert.equal(statusDoPayload({ event: "purchase.approved" }), "approved");

// ── sem status no payload, o tipo do endpoint decide ──
assert.equal(resolverStatusVenda({ id: 1 }, "compra_aprovada"), "approved");
assert.equal(resolverStatusVenda({ id: 1 }, "reembolso"), "refunded");

// ── carrinho abandonado NUNCA vira venda, nem com status no payload ──
assert.equal(resolverStatusVenda({ status: "paid" }, "carrinho_abandonado"), null);

// ── nada reconhecível não vira venda ──
assert.equal(resolverStatusVenda({ foo: "bar" }, "webhook_qualquer"), null);
assert.equal(statusDoPayload({}), null);
assert.equal(statusDoPayload(null), null);

console.log("venda-status: all assertions passed");
