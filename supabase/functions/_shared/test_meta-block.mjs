// Run: node supabase/functions/_shared/test_meta-block.mjs
import assert from "node:assert/strict";
import { bloqueioDeConta } from "./meta-block.mjs";

// O caso visto em produção: conta comercial travada.
assert.match(bloqueioDeConta("131031"), /travada/);
assert.match(bloqueioDeConta(131031), /travada/, "código numérico também");
assert.match(bloqueioDeConta("368"), /políticas/);
assert.match(bloqueioDeConta("131042"), /pagamento/);

// Erros de MENSAGEM não podem virar bloqueio de conta: parar tudo por causa de
// um número errado seria pior que o problema.
assert.equal(bloqueioDeConta("131026"), null, "número indisponível é da mensagem");
assert.equal(bloqueioDeConta("131047"), null, "janela de 24h é da mensagem");
assert.equal(bloqueioDeConta("131053"), null, "formato de mídia é da mensagem");
assert.equal(bloqueioDeConta("190"), null, "token expirado tem tratamento próprio");

assert.equal(bloqueioDeConta(null), null);
assert.equal(bloqueioDeConta(undefined), null);
assert.equal(bloqueioDeConta(""), null);

console.log("meta-block: all assertions passed");
