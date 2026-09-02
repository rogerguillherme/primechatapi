// Run: node supabase/functions/_shared/test_missoes.mjs
import assert from "node:assert/strict";
import { avaliarMissoes } from "./missoes.mjs";

const pega = (dados, id) => avaliarMissoes(dados).find((m) => m.id === id);

// ── alvos simples ──
assert.equal(pega({ vendas: 1 }, "primeira_venda").feito, true);
assert.equal(pega({ vendas: 0 }, "primeira_venda").feito, false);
assert.equal(pega({ lucro: 10000 }, "10k").feito, true, "no alvo exato já conta");
assert.equal(pega({ lucro: 9999 }, "10k").feito, false);
assert.equal(pega({ lucro: 5000 }, "10k").progresso, 0.5);
// Progresso não passa de 100% mesmo estourando o alvo.
assert.equal(pega({ lucro: 999999 }, "10k").progresso, 1);

// ── ROI sem investimento: não se aplica, não é zero ──
// Marcar como não cumprida com 0% puniria quem nunca recebeu verba de tráfego.
assert.equal(pega({ roi: null }, "olho_clinico").progresso, null);
assert.equal(pega({ roi: 3 }, "olho_clinico").feito, true);
assert.equal(pega({ roi: 2.9 }, "olho_clinico").feito, false);
assert.equal(pega({ roi: 5 }, "mestre_roi").feito, true);

// ── volume mínimo: 0% de reembolso com 2 vendas é falta de amostra ──
assert.equal(pega({ vendas: 2, reembolsos: 0, faturamento: 500 }, "escudo").progresso, null);
assert.equal(pega({ vendas: 2, reembolsos: 0 }, "impecavel").progresso, null);
// Com amostra, aí sim vale.
assert.equal(pega({ vendas: 20, reembolsos: 0, faturamento: 10000 }, "escudo").feito, true);
assert.equal(pega({ vendas: 20, reembolsos: 500, faturamento: 10000 }, "escudo").feito, false, "5% reprova");
assert.equal(pega({ vendas: 20, reembolsos: 100, faturamento: 10000 }, "escudo").feito, true, "1% aprova");
assert.equal(pega({ vendas: 20, reembolsos: 1 }, "impecavel").feito, false);

// ── meta não definida não é meta perdida ──
assert.equal(pega({ meta: 0, faturamento: 9999 }, "meta_batida").progresso, null);
assert.equal(pega({ meta: 5000, faturamento: 5000 }, "meta_batida").feito, true);

// ── histórico ──
assert.equal(pega({ acumulado: 1000000 }, "milhao").feito, true);
assert.equal(pega({ acumulado: 500000 }, "milhao").progresso, 0.5);

// Vendedor zerado não quebra nada nem desbloqueia nada.
const zerado = avaliarMissoes({});
assert.equal(zerado.filter((m) => m.feito).length, 0);
assert.ok(zerado.length >= 10);

console.log("missoes: all assertions passed");
