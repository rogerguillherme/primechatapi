// Run: node supabase/functions/_shared/test_evo-error.mjs
import assert from "node:assert/strict";
import { evoErrorMessage } from "./evo-error.mjs";

// O caso do lead Kauã: a tela mostrava só o rótulo, a causa ficava escondida.
assert.equal(
  evoErrorMessage({ status: 500, error: "Internal Server Error", response: { message: ["Connection Closed"] } }, 500),
  "Internal Server Error: Connection Closed",
);

// Instância fora do ar é a causa mais comum por trás do 500 genérico.
assert.equal(
  evoErrorMessage({ error: "Internal Server Error", response: { message: ["The instance is not connected"] } }, 500),
  "Internal Server Error: The instance is not connected",
);

// Número inexistente vem como objeto dentro do array.
assert.equal(
  evoErrorMessage({ error: "Bad Request", response: { message: [{ exists: false, number: "5511999994244" }] } }, 400),
  "Bad Request: o número 5511999994244 não tem WhatsApp",
);

// Várias mensagens de uma vez continuam legíveis.
assert.equal(
  evoErrorMessage({ error: "Bad Request", response: { message: ["number is required", "text is required"] } }, 400),
  "Bad Request: number is required · text is required",
);

// Formato simples, sem embrulho.
assert.equal(evoErrorMessage({ message: "Instance not found" }, 404), "Instance not found");

// Rótulo sozinho ainda é melhor que nada.
assert.equal(evoErrorMessage({ error: "Unauthorized" }, 401), "Unauthorized");

// Não repete o rótulo quando ele é a única informação existente.
assert.equal(evoErrorMessage({ error: "Forbidden", response: { message: ["Forbidden"] } }, 403), "Forbidden");

// Corpo que não era JSON cai no campo raw.
assert.equal(evoErrorMessage({ raw: "502 Bad Gateway" }, 502), "502 Bad Gateway");

// Sem corpo nenhum, a frase genérica traz ao menos o status.
assert.equal(evoErrorMessage(null, 503), "Falha no envio via Evolution API (HTTP 503).");
assert.equal(evoErrorMessage({}, 500), "Falha no envio via Evolution API (HTTP 500).");

console.log("evo-error: all assertions passed");
