// Check da aritmética das métricas de disparo.
// Rodar: npm test
import { describe, expect, it } from "vitest";
import {
  aggregateByAccount,
  aggregateBySource,
  counterDrift,
  progressBar,
  rate,
  sumRows,
  type SourceMetricRow,
} from "./sendingMetrics";

const row = (p: Partial<SourceMetricRow>): SourceMetricRow => ({
  source: "broadcast",
  account_id: null,
  sent: 0,
  delivered: 0,
  read: 0,
  failed: 0,
  skipped: 0,
  pending: 0,
  tracks_delivery: true,
  ...p,
});

describe("sumRows", () => {
  it("soma várias contas da mesma origem", () => {
    const t = sumRows("broadcast", [
      row({ account_id: "a", sent: 1200, delivered: 900, read: 400, failed: 30 }),
      row({ account_id: "b", sent: 800, delivered: 700, read: 250, failed: 10 }),
    ]);
    expect(t.sent).toBe(2000);
    expect(t.delivered).toBe(1600);
    expect(t.read).toBe(650);
    expect(t.failed).toBe(40);
    expect(t.total).toBe(2040);
  });

  it("não estoura o teto de 1.000 (o bug: a soma parava no milésimo evento)", () => {
    // 12 contas x 1.000 mensagens. O código antigo buscava campaign_events sem
    // limite e o PostgREST cortava em 1.000 linhas — entregues travava em <=1000.
    const rows = Array.from({ length: 12 }, (_, i) =>
      row({ account_id: `acc-${i}`, sent: 1000, delivered: 950, read: 500 })
    );
    const t = sumRows("broadcast", rows);
    expect(t.sent).toBe(12_000);
    expect(t.delivered).toBe(11_400);
    expect(t.read).toBe(6_000);
  });

  it("mantém lido <= entregue <= enviado mesmo com dado torto do webhook", () => {
    const t = sumRows("chat", [row({ source: "chat", sent: 100, delivered: 140, read: 200 })]);
    expect(t.delivered).toBe(100);
    expect(t.read).toBe(100);
  });

  it("origem sem rastreio de entrega devolve null, não zero", () => {
    const t = sumRows("flow", [
      row({ source: "flow", sent: 500, delivered: null, read: null, failed: 12, pending: 40, tracks_delivery: false }),
    ]);
    expect(t.sent).toBe(500);
    expect(t.delivered).toBeNull();
    expect(t.read).toBeNull();
    expect(t.total).toBe(552);
  });
});

describe("aggregateBySource", () => {
  const rows: SourceMetricRow[] = [
    row({ source: "broadcast", account_id: "a", sent: 5000, delivered: 4800, read: 2100, failed: 120 }),
    row({ source: "chat", account_id: "a", sent: 900, delivered: 880, read: 610, failed: 4 }),
    row({ source: "flow", sent: 300, delivered: null, read: null, failed: 7, pending: 20, tracks_delivery: false }),
  ];

  it("nunca mistura as origens (o bug do Math.max)", () => {
    const [broadcast, flow, chat] = aggregateBySource(rows);
    expect(broadcast.sent).toBe(5000);
    expect(flow.sent).toBe(300);
    expect(chat.sent).toBe(900);
    // o resumo antigo devolvia Math.max(5000, 900) = 5000 e sumia com o chat
    expect(broadcast.sent + flow.sent + chat.sent).toBe(6200);
  });

  it("devolve sempre as três origens, zeradas quando não há dado", () => {
    const totals = aggregateBySource([]);
    expect(totals.map((t) => t.source)).toEqual(["broadcast", "flow", "chat"]);
    expect(totals.every((t) => t.total === 0)).toBe(true);
  });
});

describe("aggregateByAccount", () => {
  it("agrupa por conta e deixa fluxo de fora (flow_executions não tem conta)", () => {
    const byAccount = aggregateByAccount([
      row({ source: "broadcast", account_id: "a", sent: 10 }),
      row({ source: "chat", account_id: "a", sent: 5 }),
      row({ source: "broadcast", account_id: null, sent: 3 }),
      row({ source: "flow", sent: 99, tracks_delivery: false }),
    ]);
    expect(byAccount.get("a")!.map((t) => [t.source, t.sent])).toEqual([
      ["broadcast", 10],
      ["chat", 5],
    ]);
    expect(byAccount.get("unknown")!.map((t) => t.sent)).toEqual([3]);
    expect([...byAccount.values()].flat().some((t) => t.source === "flow")).toBe(false);
  });
});

describe("progressBar", () => {
  it("empilha segmentos disjuntos — não soma categorias que se sobrepõem", () => {
    const b = progressBar({ audience: 1000, sent: 900, delivered: 700, read: 300, failed: 50 });
    expect(b.total).toBe(1000);
    expect(b.pending).toBe(50); // 1000 - 900 - 50
    const s = b.segments;
    expect(s.read).toBeCloseTo(30);
    expect(s.deliveredOnly).toBeCloseTo(40); // 700 - 300
    expect(s.sentOnly).toBeCloseTo(20); // 900 - 700
    expect(s.failed).toBeCloseTo(5);
    expect(s.pending).toBeCloseTo(5);
    const soma = s.read + s.deliveredOnly + s.sentOnly + s.failed + s.skipped + s.pending;
    expect(soma).toBeCloseTo(100);
  });

  it("nunca passa de 100% quando o job envia mais que o alvo", () => {
    const b = progressBar({ audience: 100, sent: 130, delivered: 130, read: 90, failed: 0 });
    expect(b.total).toBe(130);
    expect(b.pending).toBe(0);
    expect(b.progressPct).toBeCloseTo(100);
    const s = b.segments;
    expect(s.read + s.deliveredOnly + s.sentOnly + s.failed + s.skipped + s.pending).toBeCloseTo(100);
  });

  it("clampa lido > entregue vindo torto do banco", () => {
    const b = progressBar({ audience: 10, sent: 10, delivered: 4, read: 9, failed: 0 });
    expect(b.delivered).toBe(4);
    expect(b.read).toBe(4);
    expect(b.segments.deliveredOnly).toBe(0);
  });

  it("job vazio não divide por zero", () => {
    const b = progressBar({ audience: 0, sent: 0, delivered: 0, read: 0, failed: 0 });
    expect(b.total).toBe(0);
    expect(b.progressPct).toBe(0);
    expect(Object.values(b.segments).every((v) => v === 0)).toBe(true);
  });
});

describe("rate", () => {
  it("sem base devolve null em vez de 0%", () => {
    expect(rate(0, 0)).toBeNull();
    expect(rate(null, 100)).toBeNull();
    expect(rate(50, 200)).toBe(25);
  });
});

describe("counterDrift", () => {
  it("ignora ruído pequeno", () => {
    expect(counterDrift(1000, 995)).toBeNull();
    expect(counterDrift(5, 0)).toBeNull();
  });

  it("mostra divergência real em vez de escondê-la com Math.max", () => {
    expect(counterDrift(1200, 800)).toBe(400);
    expect(counterDrift(800, 1200)).toBe(-400);
  });
});
