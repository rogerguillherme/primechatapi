// Run: node supabase/functions/_shared/test_metrics-engine.mjs
import assert from "node:assert/strict";
import {
  eloAtual, proximoElo, progressoNoElo, comissao, progressoMeta, roas, roi,
  baseComissao, comissaoSobreBase,
} from "./metrics-engine.mjs";

const ELOS = [
  { name: "Bronze", min_value: 0, commission_pct: 5 },
  { name: "Prata", min_value: 10000, commission_pct: 8 },
  { name: "Ouro", min_value: 30000, commission_pct: 10 },
  { name: "Diamante", min_value: 100000, commission_pct: 12 },
];

// ── elo atual ──
assert.equal(eloAtual(ELOS, 0).name, "Bronze", "no corte exato já vale o elo");
assert.equal(eloAtual(ELOS, 9999).name, "Bronze");
assert.equal(eloAtual(ELOS, 10000).name, "Prata", "corte é inclusivo");
assert.equal(eloAtual(ELOS, 250000).name, "Diamante", "acima do topo continua no topo");

// Elos fora de ordem no banco não podem mudar o resultado.
assert.equal(eloAtual([...ELOS].reverse(), 30000).name, "Ouro");

// Sem elo cadastrado não se inventa um.
assert.equal(eloAtual([], 50000), null);
assert.equal(eloAtual(ELOS, 0) !== null, true);

// Primeiro corte acima de zero: abaixo dele não há elo, que é diferente de zerado.
const COM_PISO = [{ name: "Prata", min_value: 5000, commission_pct: 8 }];
assert.equal(eloAtual(COM_PISO, 4999), null, "abaixo do primeiro corte não há elo");

// ── próximo elo ──
assert.equal(proximoElo(ELOS, 0).tier.name, "Prata");
assert.equal(proximoElo(ELOS, 0).falta, 10000);
assert.equal(proximoElo(ELOS, 29000).falta, 1000);
assert.equal(proximoElo(ELOS, 150000), null, "no topo não há próximo");

// ── progresso dentro do elo ──
// Metade do caminho entre Prata (10k) e Ouro (30k) é 20k.
assert.equal(progressoNoElo(ELOS, 20000), 0.5);
// Recém-promovido começa a barra do zero, não quase cheia.
assert.equal(progressoNoElo(ELOS, 10000), 0);
assert.equal(progressoNoElo(ELOS, 150000), 1, "no topo a barra está cheia");

// ── comissão ──
assert.equal(comissao(10000, ELOS), 800, "8% de Prata");
assert.equal(comissao(100000, ELOS), 12000, "12% de Diamante");
assert.equal(comissao(0, ELOS), 0);
assert.equal(comissao(50000, []), 0, "sem elo, sem comissão");
assert.equal(comissao(4999, COM_PISO), 0, "abaixo do primeiro corte não comissiona");
// Centavos não podem virar dízima na tela.
assert.equal(comissao(333.33, ELOS), 16.67, "arredonda ao centavo");

// ── progresso de meta ──
assert.equal(progressoMeta(5000, 10000), 0.5);
assert.equal(progressoMeta(15000, 10000), 1, "passou da meta não passa de 100%");
// Meta zero é meta não definida — nem 100%, nem divisão por zero. O plano
// registra que no sistema avaliado o denominador zero produzia "100.00x".
assert.equal(progressoMeta(5000, 0), null);
assert.equal(progressoMeta(0, 0), null);
assert.equal(progressoMeta(0, 10000), 0);

// ── ROAS e ROI ──
assert.equal(roas(10000, 2000), 5, "cinco reais de volta por real gasto");
assert.equal(roi(10000, 2000), 4, "quatro reais de lucro por real gasto");

// Gastar mais do que voltou é resultado real, não erro: aparece negativo.
assert.equal(roi(1000, 2000), -0.5);
assert.equal(roas(1000, 2000), 0.5);

// Gasto ZERO não é retorno infinito nem zero — é "não se aplica".
// Sem isto, quem não recebeu tráfego vira o mais eficiente da equipe e o
// ranking deixa de significar qualquer coisa. É a armadilha do plano.
assert.equal(roas(10000, 0), null, "faturou sem gastar: ROAS não se aplica");
assert.equal(roi(10000, 0), null);
assert.equal(roas(0, 0), null);
assert.equal(roas(10000, -50), null, "gasto negativo é dado ruim, não divisor");

// Faturamento zero com gasto real é -100%: perdeu tudo o que investiu.
assert.equal(roi(0, 500), -1);
assert.equal(roas(0, 500), 0);

// ── base de comissão ──
// Faturamento cru NÃO é base: a plataforma retém a taxa e reembolso voltou.
assert.equal(baseComissao(1000, 0, 0), 1000, "sem taxa e sem reembolso, base é o bruto");
assert.equal(baseComissao(1000, 0, 10), 900, "taxa de 10% sai da base");
assert.equal(baseComissao(1000, 200, 0), 800, "reembolso sai da base");
// A taxa incide sobre o que sobrou: o checkout devolve a taxa do estornado.
assert.equal(baseComissao(1000, 200, 10), 720, "reembolso primeiro, taxa depois");

// Devolveu mais do que entrou: não existe base negativa para comissionar.
assert.equal(baseComissao(500, 900, 10), 0, "base nunca fica negativa");
assert.equal(baseComissao(0, 0, 10), 0);

// Taxa fora da faixa não vira multiplicador maluco.
assert.equal(baseComissao(1000, 0, -5), 1000, "taxa negativa é ignorada");
assert.equal(baseComissao(1000, 0, 150), 0, "taxa acima de 100% zera, não inverte");

// ── comissão sobre a base ──
// 10% sobre 720 = 72. É a conta que o Roger descreveu.
assert.equal(comissaoSobreBase(720, [], 1000, 10), 72, "padrão quando não há elo");
// Havendo elo, o percentual dele manda.
assert.equal(comissaoSobreBase(720, ELOS, 10000, 10), 57.6, "8% de Prata sobre a base");
assert.equal(comissaoSobreBase(0, ELOS, 10000, 10), 0, "base zero não comissiona");

console.log("metrics-engine: all assertions passed");
