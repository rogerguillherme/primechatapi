// Run: node supabase/functions/_shared/test_webhook-secret.mjs
import assert from "node:assert/strict";
import { checkWebhookSecretValue } from "./webhook-secret.ts";

const req = (opts) =>
  new Request(`https://x.test/functions/v1/evolution-webhook${opts.query || ""}`, {
    headers: opts.header ? { "x-webhook-secret": opts.header } : {},
  });

// Segredo por query bate.
assert.equal(checkWebhookSecretValue(req({ query: "?secret=abc" }), "abc"), true);
// Segredo por header bate.
assert.equal(checkWebhookSecretValue(req({ header: "abc" }), "abc"), true);
// Segredo errado não bate — é o caso que isola conta B do segredo de conta A.
assert.equal(checkWebhookSecretValue(req({ query: "?secret=outro" }), "abc"), false);
// Sem segredo nenhum na conta (null/undefined) nunca autentica, mesmo que a
// requisição não mande nada — fecha, não abre.
assert.equal(checkWebhookSecretValue(req({}), null), false);
assert.equal(checkWebhookSecretValue(req({ query: "?secret=" }), undefined), false);

console.log("webhook-secret: all assertions passed");
