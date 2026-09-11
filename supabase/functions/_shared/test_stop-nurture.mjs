// Self-check do pararNutricao. Sem framework.
// Run: node supabase/functions/_shared/test_stop-nurture.mjs
import assert from "node:assert/strict";
import { pararNutricao } from "./stop-nurture.mjs";

// ── mock mínimo do client do supabase-js (só o que pararNutricao usa) ──
function makeAdmin(rows) {
  return {
    from(table) {
      assert.equal(table, "flow_executions");
      let filterLead = null;
      let filterStatuses = null;
      const api = {
        select() { return api; },
        eq(col, val) {
          if (col === "lead_id") filterLead = val;
          return api;
        },
        in(col, vals) { if (col === "status") filterStatuses = vals; return api; },
        then(resolve) {
          // usado no `await` da leitura (select().eq().in())
          const data = rows.filter(
            (r) => r.lead_id === filterLead && filterStatuses.includes(r.status),
          );
          resolve({ data, error: null });
        },
        update(patch) {
          return {
            eq(col, val) {
              const row = rows.find((r) => r[col] === val);
              if (row) Object.assign(row, patch);
              return { error: null };
            },
          };
        },
      };
      return api;
    },
  };
}

// ── caso 1: cancela só as em andamento do lead certo ──
const rows = [
  { id: "a", lead_id: "L1", status: "waiting_delay", metadata: { trigger: "mensagem_recebida", account_id: "acc1" } },
  { id: "b", lead_id: "L1", status: "completed", metadata: {} },
  { id: "c", lead_id: "L2", status: "running", metadata: {} },
  { id: "d", lead_id: "L1", status: "waiting_reply", metadata: null },
];
const admin = makeAdmin(rows);
const n = await pararNutricao(admin, "L1", "comprou");

assert.equal(n, 2, "canceladas: a e d");
assert.equal(rows.find((r) => r.id === "a").status, "cancelled");
assert.deepEqual(
  rows.find((r) => r.id === "a").metadata,
  { trigger: "mensagem_recebida", account_id: "acc1", stop_reason: "comprou" },
  "metadata preservado + stop_reason",
);
assert.equal(rows.find((r) => r.id === "d").metadata.stop_reason, "comprou", "metadata null vira objeto");
assert.equal(rows.find((r) => r.id === "b").status, "completed", "execução concluída não é tocada");
assert.equal(rows.find((r) => r.id === "c").status, "running", "execução de outro lead não é tocada");

// ── caso 2: lead sem execuções / leadId nulo ──
assert.equal(await pararNutricao(makeAdmin([]), "L9"), 0);
assert.equal(await pararNutricao(makeAdmin(rows), null), 0);

console.log("stop-nurture: all assertions passed");
