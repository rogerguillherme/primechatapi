// Self-check for the Metrito money/status mapping.
// Run: node supabase/functions/_shared/test_metrito.mjs
import assert from "node:assert/strict";
import {
  mapHublaStatusToMetrito,
  toCents,
  pickMetritoCreds,
  METRITO_STATUSES,
} from "./metrito-map.mjs";

// ── status mapping ──
const cases = {
  approved: "approved",
  paid: "approved",
  APPROVED: "approved",
  authorized: "authorized",
  refunded: "refunded",
  chargeback: "chargeback",
  cancelled: "failed",
  canceled: "failed",
  failed: "failed",
  expired: "failed",
  abandoned: "pending",
  pending: "pending",
  unpaid: "pending",
  under_analysis: "under_analysis",
  "": "pending",
  banana: "pending",
};
for (const [input, expected] of Object.entries(cases)) {
  assert.equal(mapHublaStatusToMetrito(input), expected, `status ${JSON.stringify(input)}`);
}
assert.equal(mapHublaStatusToMetrito(null), "pending");
assert.equal(mapHublaStatusToMetrito(undefined), "pending");

// Every output must be inside Metrito's enum, or the transaction is rejected.
for (const out of Object.values(cases)) {
  assert.ok(METRITO_STATUSES.includes(out), `${out} not in enum`);
}

// ── cents conversion ──
assert.equal(toCents(29.99), 2999, "float 29.99 must not truncate to 2998");
assert.equal(toCents(0.1 + 0.2), 30, "0.30000000000000004 -> 30");
assert.equal(toCents(1234.56), 123456);
assert.equal(toCents(100), 10000);
assert.equal(toCents(0), 0);
assert.equal(toCents("47.90"), 4790);
assert.equal(toCents(19.995), 2000);
assert.equal(toCents(null), 0);
assert.equal(toCents(undefined), 0);
assert.equal(toCents(""), 0);
assert.equal(toCents("abc"), 0);
assert.equal(toCents(NaN), 0);
assert.ok(Number.isInteger(toCents(8.815)), "cents must always be an integer");

// ── round-trip do caminho real ──
// hubla-webhook faz `amount = invoice.amount.totalCents / 100` e nós desfazemos
// com toCents. A volta tem que ser exata para todo centavo.
for (const totalCents of [1, 7, 99, 100, 2999, 4790, 8815, 19990, 123456, 999999]) {
  assert.equal(toCents(totalCents / 100), totalCents, `round-trip ${totalCents}`);
}
for (let c = 0; c < 2000; c++) {
  assert.equal(toCents(c / 100), c, `round-trip ${c}`);
}

console.log("metrito map: all assertions passed");

// ── escolha de credencial: conta própria x global ──
{
  const env = { apiKey: "env-key", genericKey: "env-gen", projectId: "env-proj" };

  // Sem cadastro próprio: cai inteiro no global.
  assert.deepEqual(pickMetritoCreds(null, env), env, "sem linha -> global");
  assert.deepEqual(
    pickMetritoCreds({ apiKey: "", genericKey: "  ", projectId: null }, env),
    env,
    "linha em branco -> global",
  );

  // Com cadastro próprio: usa só o dela, sem herdar campo do global.
  assert.deepEqual(
    pickMetritoCreds({ apiKey: "own-key", genericKey: "", projectId: "" }, env),
    { apiKey: "own-key", genericKey: null, projectId: null },
    "cadastro parcial nao herda campo do global",
  );
  assert.deepEqual(
    pickMetritoCreds({ apiKey: " own-key ", genericKey: "own-gen", projectId: "own-proj" }, env),
    { apiKey: "own-key", genericKey: "own-gen", projectId: "own-proj" },
    "cadastro completo, com trim",
  );

  // Global também ausente: tudo nulo, features ficam inertes.
  assert.deepEqual(
    pickMetritoCreds(null, {}),
    { apiKey: null, genericKey: null, projectId: null },
    "sem conta e sem global -> inerte",
  );
}

console.log("metrito creds: all assertions passed");
