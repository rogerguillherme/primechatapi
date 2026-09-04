// Run: node supabase/functions/_shared/test_meta-webhook-groups.mjs
import assert from "node:assert/strict";
import { groupChangesByPhoneNumber } from "./meta-webhook-groups.mjs";

// ── o caso que causava a mistura entre contas ──
// Duas BMs diferentes, mesmo app, evento entregue no mesmo POST.
const contaA = {
  metadata: { phone_number_id: "111" },
  messages: [{ id: "wamid.A1", from: "5511900000001" }],
};
const contaB = {
  metadata: { phone_number_id: "222" },
  messages: [{ id: "wamid.B1", from: "5511900000002" }],
};

const grupos = groupChangesByPhoneNumber([contaA, contaB]);
assert.equal(grupos.length, 2, "duas contas viram dois grupos, nunca um só");

const porNumero = new Map(grupos.map((g) => [g.metadata.phone_number_id, g]));
assert.equal(porNumero.get("111").messages.length, 1);
assert.equal(porNumero.get("111").messages[0].id, "wamid.A1");
assert.equal(porNumero.get("222").messages.length, 1);
assert.equal(porNumero.get("222").messages[0].id, "wamid.B1");
// A mensagem da conta B nunca pode aparecer dentro do grupo da conta A.
assert.equal(
  porNumero.get("111").messages.some((m) => m.id === "wamid.B1"),
  false,
  "mensagem da conta B vazou pro grupo da conta A",
);

// ── caso legítimo: Meta separa change de mensagem e de status do MESMO número ──
const msgChange = { metadata: { phone_number_id: "111" }, messages: [{ id: "wamid.A1" }] };
const statusChange = { metadata: { phone_number_id: "111" }, statuses: [{ id: "wamid.A0", status: "read" }] };
const mesmoNumero = groupChangesByPhoneNumber([msgChange, statusChange]);
assert.equal(mesmoNumero.length, 1, "mesmo número continua fundindo num grupo só");
assert.equal(mesmoNumero[0].messages.length, 1);
assert.equal(mesmoNumero[0].statuses.length, 1);

// ── sem metadata (não deveria acontecer, mas não pode quebrar) ──
const semMetadata = groupChangesByPhoneNumber([{ messages: [{ id: "x" }] }]);
assert.equal(semMetadata.length, 1);

// ── lista vazia ──
assert.deepEqual(groupChangesByPhoneNumber([]), []);
assert.deepEqual(groupChangesByPhoneNumber(undefined), []);

console.log("meta-webhook-groups: all assertions passed");
