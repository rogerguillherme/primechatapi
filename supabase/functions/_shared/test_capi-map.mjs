// Self-check for the CAPI credential mapping.
// Run: node supabase/functions/_shared/test_capi-map.mjs
import assert from "node:assert/strict";
import { pickCapiCreds } from "./capi-map.mjs";

const env = { pixelId: "env-pixel", accessToken: "env-token", testEventCode: "env-test" };

// Sem cadastro próprio: cai inteiro no global.
assert.deepEqual(pickCapiCreds(null, env), env, "sem linha -> global");
assert.deepEqual(
  pickCapiCreds({ pixelId: "", accessToken: "  ", testEventCode: null }, env),
  env,
  "linha em branco -> global",
);

// Com cadastro próprio: usa só o dela, sem herdar campo do global.
assert.deepEqual(
  pickCapiCreds({ pixelId: "own-pixel", accessToken: "", testEventCode: "" }, env),
  { pixelId: "own-pixel", accessToken: null, testEventCode: null },
  "cadastro parcial nao herda campo do global",
);
assert.deepEqual(
  pickCapiCreds({ pixelId: " own-pixel ", accessToken: "own-token", testEventCode: "own-test" }, env),
  { pixelId: "own-pixel", accessToken: "own-token", testEventCode: "own-test" },
  "cadastro completo, com trim",
);

// Global também ausente: tudo nulo, feature fica inerte.
assert.deepEqual(
  pickCapiCreds(null, {}),
  { pixelId: null, accessToken: null, testEventCode: null },
  "sem conta e sem global -> inerte",
);

console.log("capi creds: all assertions passed");
