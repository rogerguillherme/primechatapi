// Run: node supabase/functions/_shared/test_phone.mjs
import assert from "node:assert/strict";
import { normalizeWaId, phoneVariants, normalizeTypedPhone, telefoneImplausivel } from "./phone.mjs";

// ── o caso que motivou isto ──
// +351 927 092 084, de Portugal. O código antigo grudava 55 e gravava
// 55351927092084: quatorze dígitos, número que não existe. Toda resposta
// falhava com 131026 enquanto as mensagens dele chegavam normalmente.
assert.equal(normalizeWaId("351927092084"), "351927092084");
assert.equal(normalizeWaId("+351 927 092 084"), "351927092084");

// Estrangeiro não ganha nono dígito inventado. A segunda forma é a corrompida
// que ficou no banco, e só serve para reencontrar o lead e consertá-lo.
assert.deepEqual(phoneVariants("351927092084"), ["351927092084", "55351927092084"]);

// ── Brasil: a alternância do nono dígito continua valendo ──
assert.deepEqual(phoneVariants("5511987654321"), ["5511987654321", "551187654321"]);
assert.deepEqual(phoneVariants("551187654321"), ["551187654321", "5511987654321"]);

// Fixo brasileiro (8 dígitos, não começa com 9) não vira celular.
assert.deepEqual(phoneVariants("551132654321"), ["551132654321", "5511932654321"]);

// ── o número já corrompido, chegando de novo ──
// Começa com 55, então entra pelo ramo brasileiro; nenhuma variante extra é
// gerada porque o resto não tem 10 nem 11 dígitos. O importante é não explodir.
assert.deepEqual(phoneVariants("55351927092084"), ["55351927092084"]);

// ── entradas vazias ──
assert.deepEqual(phoneVariants(""), []);
assert.deepEqual(phoneVariants(null), []);
assert.equal(normalizeWaId(undefined), "");

// ── telefone digitado (checkout, importação, cadastro) ──
// Aqui o DDI pode faltar de verdade, e o comprimento decide.
assert.equal(normalizeTypedPhone("11987654321"), "5511987654321", "celular BR sem DDI");
assert.equal(normalizeTypedPhone("1132654321"), "551132654321", "fixo BR sem DDI");
assert.equal(normalizeTypedPhone("(11) 98765-4321"), "5511987654321", "com pontuação");

// Já tem DDI: não se mexe.
assert.equal(normalizeTypedPhone("5511987654321"), "5511987654321", "BR com DDI");
assert.equal(normalizeTypedPhone("351927092084"), "351927092084", "Portugal intacto");
assert.equal(normalizeTypedPhone("14155552671"), "5514155552671", "EUA de 11 dígitos vira BR — limite conhecido da heurística");

// Lixo não vira número.
assert.equal(normalizeTypedPhone(""), "");
assert.equal(normalizeTypedPhone("123"), "123");

// ── plausibilidade: barrar erro nosso antes de virar estatística ruim ──
assert.equal(telefoneImplausivel("5511987654321"), null, "celular BR válido");
assert.equal(telefoneImplausivel("351927092084"), null, "Portugal válido");
assert.equal(telefoneImplausivel("14155552671"), null, "EUA válido");

assert.match(telefoneImplausivel("55351927092084"), /duplicado/, "o caso do Gabriel");
assert.match(telefoneImplausivel("123"), /curto/);
assert.match(telefoneImplausivel("1234567890123456"), /longo/);

console.log("phone: all assertions passed");
