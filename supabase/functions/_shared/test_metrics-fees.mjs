// Run: node supabase/functions/_shared/test_metrics-fees.mjs
import assert from "node:assert/strict";
import { taxaAplicavel, taxaDaVenda, baseConfigurada, taxaEfetiva } from "./metrics-fees.mjs";

const REGRAS = [
  { platform: "applyfy", payment_method: "pix", percent: 3, fixed: 2.49 },
  { platform: "applyfy", payment_method: "cartao", percent: 1, fixed: 2.49 },
  { platform: "perfectpay", payment_method: null, percent: 5.4, fixed: 2 },
  { platform: null, payment_method: null, percent: 4, fixed: 0 },
];

// ── escolha da regra: do específico para o geral ──
assert.equal(taxaAplicavel(REGRAS, "applyfy", "pix").percent, 3);
assert.equal(taxaAplicavel(REGRAS, "applyfy", "cartao").percent, 1);
// Plataforma configurada sem meio vale para qualquer meio dela.
assert.equal(taxaAplicavel(REGRAS, "perfectpay", "boleto").percent, 5.4);
// Plataforma desconhecida cai na regra geral.
assert.equal(taxaAplicavel(REGRAS, "kiwify", "pix").percent, 4);
// Sem regra nenhuma não se inventa taxa.
assert.equal(taxaAplicavel([], "applyfy", "pix"), null);

// ── o valor da taxa ──
// 3% + R$2,49 sobre R$1.000.
assert.equal(taxaDaVenda(1000, REGRAS, "applyfy", "pix"), 32.49);
// A parte FIXA é o que mais dói em venda pequena: em R$20 isso é 12%, não 3%.
assert.equal(taxaDaVenda(20, REGRAS, "applyfy", "pix"), 3.09);
// Taxa nunca passa do valor da venda: base negativa viraria comissão negativa.
assert.equal(taxaDaVenda(1, REGRAS, "applyfy", "pix"), 1);
assert.equal(taxaDaVenda(0, REGRAS, "applyfy", "pix"), 0);
assert.equal(taxaDaVenda(1000, [], "applyfy", "pix"), 0, "sem regra, sem taxa");

// ── base com o que descontar configurável ──
const n = { faturamento: 10000, reembolsos: 500, taxas: 800, ads: 1200 };
// O padrão do simulador da tela: taxas e reembolsos sim, ads não.
assert.equal(baseConfigurada(n), 8700);
assert.equal(baseConfigurada(n, { descontarAds: true }), 7500);
assert.equal(baseConfigurada(n, { descontarTaxas: false }), 9500);
assert.equal(baseConfigurada(n, { descontarReembolsos: false }), 9200);
// Tudo desligado devolve o bruto.
assert.equal(
  baseConfigurada(n, { descontarTaxas: false, descontarReembolsos: false }),
  10000,
);
// Descontos maiores que o faturamento não produzem base negativa.
assert.equal(baseConfigurada({ faturamento: 100, reembolsos: 500 }), 0);

// ── taxa real vence a configurada ──
// A venda do CSV: cliente pagou 383,64 em 12x e sobraram 294,51. A taxa real
// é 89,13 — a regra de "3% + R$2,49" daria 14,00 e erraria em 75 reais.
assert.equal(taxaEfetiva(383.64, 294.51, REGRAS, "applyfy", "cartao"), 89.13);

// Sem líquido informado, a regra configurada assume.
assert.equal(taxaEfetiva(1000, null, REGRAS, "applyfy", "pix"), 32.49);
assert.equal(taxaEfetiva(1000, undefined, REGRAS, "applyfy", "pix"), 32.49);
assert.equal(taxaEfetiva(1000, "", REGRAS, "applyfy", "pix"), 32.49);

// Líquido igual ao bruto = plataforma sem taxa, não "usar a regra".
assert.equal(taxaEfetiva(500, 500, REGRAS, "applyfy", "pix"), 0);
// Líquido maior que o bruto é dado ruim: taxa zero, nunca negativa.
assert.equal(taxaEfetiva(500, 600, REGRAS, "applyfy", "pix"), 0);

console.log("metrics-fees: all assertions passed");
