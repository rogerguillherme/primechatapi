// Self-check da substituição de variáveis das mensagens de fluxo.
// Run: node supabase/functions/_shared/test_interpolate.mjs
import assert from "node:assert/strict";
import { interpolate, variableCandidates, mergeScalarVars } from "./interpolate.mjs";

const vars = {
  nome: "Ana",
  name: "Ana",
  primeiro_nome: "Ana",
  nome_completo: "Ana Souza",
  telefone: "5511999998888",
  phone: "5511999998888",
  email: "ana@exemplo.com",
  valor: "R$ 297,00",
};

// ── o bug que motivou isto ──
// Fluxo gerado por IA escreve o nome por extenso; a regex antiga (\w+) não
// casava espaço, então o link ia para o cliente com o placeholder literal.
assert.equal(
  interpolate("checkout?utm_content=lead_{Telefone do lead}", vars),
  "checkout?utm_content=lead_5511999998888",
  "nome com espaços",
);
assert.equal(
  interpolate("{Telefone do lead | leadPhone}", vars),
  "5511999998888",
  "forma com pipe",
);

// ── variações de escrita que precisam resolver para a mesma variável ──
for (const form of [
  "{telefone}", "{Telefone}", "{TELEFONE}", "{ telefone }",
  "{Telefone do lead}", "{telefone do cliente}", "{leadPhone}",
  "{lead_phone}", "{Telefone-do-lead}",
]) {
  assert.equal(interpolate(form, vars), vars.telefone, `forma ${form}`);
}
for (const form of ["{nome}", "{Nome do lead}", "{primeiro nome}", "{leadName}"]) {
  assert.equal(interpolate(form, vars), "Ana", `forma ${form}`);
}

// ── o que NÃO pode mudar ──
// Variável desconhecida fica visível, não vira lacuna silenciosa.
assert.equal(interpolate("Oi {sobrenome}!", vars), "Oi {sobrenome}!", "desconhecida intacta");
// Valor vazio também mantém o placeholder, para o operador perceber.
assert.equal(interpolate("{codigo}", { ...vars, codigo: "" }), "{codigo}", "vazio intacto");
// Placeholder numerado de template segue recebendo o primeiro nome.
assert.equal(interpolate("Olá {{1}}, tudo bem?", vars), "Olá Ana, tudo bem?", "template {{1}}");
// Chaves fora de contexto de variável não quebram o texto.
assert.equal(interpolate("função() { return 1 }", vars), "função() { return 1 }", "chave solta");
// Texto vazio/nulo passa reto.
assert.equal(interpolate("", vars), "");
assert.equal(interpolate(null, vars), null);

// ── ordem dos candidatos: do mais literal para o mais reduzido ──
assert.deepEqual(
  variableCandidates("Telefone do lead"),
  ["telefone_do_lead", "telefone"],
  "candidatos na ordem certa",
);
// Uma variável específica do metadata não pode ser sequestrada pela redução:
// se `telefone_do_lead` existir no mapa, ela vence `telefone`.
assert.equal(
  interpolate("{Telefone do lead}", { ...vars, telefone_do_lead: "ESPECIFICO" }),
  "ESPECIFICO",
  "chave exata tem prioridade",
);

// ── mergeScalarVars: mescla metadata sem sobrescrever ──
// buildVars monta as chaves nomeadas, depois mescla flow_executions.metadata,
// depois leads.metadata com prioridade MENOR.
{
  const vars = { nome: "Ana", telefone: "5511999998888" };
  mergeScalarVars(vars, { padrao: "o inchaço", order_id: 123, nome: "IGNORADO", obj: { x: 1 }, nulo: null });
  assert.equal(vars.padrao, "o inchaço", "chave nova entra");
  assert.equal(vars.order_id, "123", "numero vira string");
  assert.equal(vars.nome, "Ana", "chave existente NAO e sobrescrita");
  assert.equal(vars.obj, undefined, "objeto aninhado e ignorado");
  assert.equal(vars.nulo, undefined, "null e ignorado");

  // leads.metadata entra depois e nao vence flow_executions.metadata
  mergeScalarVars(vars, { padrao: "a dor", link_mapa: "https://zerolipedema.com.br/mapas/ABC234.pdf" });
  assert.equal(vars.padrao, "o inchaço", "leads.metadata nao sobrescreve o que ja veio");
  assert.equal(vars.link_mapa, "https://zerolipedema.com.br/mapas/ABC234.pdf", "chave so de leads.metadata entra");

  mergeScalarVars(vars, null); // nao quebra com source nulo
  mergeScalarVars(vars, undefined);
}

console.log("interpolate: all assertions passed");
