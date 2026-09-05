// Self-check do passo "Sem Resposta".
// Run: node supabase/functions/_shared/test_no_response.mjs
import assert from "node:assert/strict";
import { decideNoResponse } from "./no-response.mjs";

const semLabels = { loadLabels: async () => [] };

// ── o bug que motivou isto ──
// Passo com "só continue se o lead NÃO responder". O lead mandou áudio, a
// condição corretamente não disparou — e o fluxo seguia assim mesmo.
{
  const conds = [{ type: "timeout", timeout_minutes: 10, key: "sem_resposta" }];
  const r = await decideNoResponse(conds, {
    elapsedMin: 15, repliedAfterStart: true, ...semLabels,
  });
  assert.equal(r.kind, "stop", "lead respondeu: o fluxo tem que PARAR, não avançar");
}

// Sem resposta dentro do tempo: aí sim continua.
{
  const conds = [{ type: "timeout", timeout_minutes: 10, key: "sem_resposta" }];
  const r = await decideNoResponse(conds, {
    elapsedMin: 15, repliedAfterStart: false, ...semLabels,
  });
  assert.deepEqual(r, { kind: "advance", branchKey: "sem_resposta" });
}

// Antes do tempo, sem resposta: espera, não decide.
{
  const conds = [{ type: "timeout", timeout_minutes: 10, key: "x" }];
  const r = await decideNoResponse(conds, {
    elapsedMin: 3, repliedAfterStart: false, ...semLabels,
  });
  assert.deepEqual(r, { kind: "requeue", waitMin: 10 });
}

// Respondeu tarde tem ramo próprio.
{
  const conds = [
    { type: "replied_late", timeout_minutes: 5, key: "respondeu" },
    { type: "timeout", timeout_minutes: 10, key: "calou" },
  ];
  const r = await decideNoResponse(conds, {
    elapsedMin: 12, repliedAfterStart: true, ...semLabels,
  });
  assert.equal(r.branchKey, "respondeu", "resposta tardia deve pegar o ramo dela");
}

// "else" continua sendo o padrão explícito de quem configurou.
{
  const conds = [
    { type: "timeout", timeout_minutes: 10, key: "calou" },
    { type: "else", timeout_minutes: 10, key: "qualquer" },
  ];
  const r = await decideNoResponse(conds, {
    elapsedMin: 12, repliedAfterStart: true, ...semLabels,
  });
  assert.equal(r.branchKey, "qualquer", "com else configurado, ele decide");
}

// Passo sem condição nenhuma mantém o comportamento antigo.
{
  const r = await decideNoResponse([], { elapsedMin: 99, repliedAfterStart: true, ...semLabels });
  assert.deepEqual(r, { kind: "advance", branchKey: null });
}

// Etiqueta só é consultada quando alguma condição precisa.
{
  let chamou = 0;
  const conds = [{ type: "timeout", timeout_minutes: 1, key: "k" }];
  await decideNoResponse(conds, {
    elapsedMin: 5, repliedAfterStart: false,
    loadLabels: async () => { chamou++; return []; },
  });
  assert.equal(chamou, 0, "consulta de etiquetas nao devia ter sido feita");
}

// E é consultada uma vez só quando duas condições precisam.
{
  let chamou = 0;
  const conds = [
    { type: "has_label", timeout_minutes: 1, label_id: "a", key: "k1" },
    { type: "no_label", timeout_minutes: 1, label_id: "b", key: "k2" },
  ];
  const r = await decideNoResponse(conds, {
    elapsedMin: 5, repliedAfterStart: false,
    loadLabels: async () => { chamou++; return ["b"]; },
  });
  assert.equal(chamou, 1, "etiquetas deviam ser carregadas uma vez");
  assert.equal(r.kind, "stop", "tinha etiqueta b e nao tinha a: nenhuma condicao bate");
}

console.log("no-response: all assertions passed");
