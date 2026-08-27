/**
 * Aritmética das métricas de disparo.
 *
 * Fica isolada aqui (sem React, sem Supabase) porque é lógica onde o erro não
 * aparece: o número só fica *errado* e ninguém percebe. `sendingMetrics.test.ts`
 * cobre os casos que já morderam — teto de linhas, categorias sobrepostas
 * somadas duas vezes, e divergência entre contador do job e contagem real.
 *
 * REGRA CENTRAL: no WhatsApp "entregue" e "lido" são estados ACUMULATIVOS.
 * lido ⊆ entregue ⊆ enviado. Nunca somar as três — só a diferença entre elas
 * pode virar segmento de barra.
 */

export type MetricSource = "broadcast" | "flow" | "chat";

export const SOURCE_LABEL: Record<MetricSource, string> = {
  broadcast: "Disparo em massa",
  flow: "Fluxos",
  chat: "Conversas (fluxo + manual)",
};

export const SOURCE_HINT: Record<MetricSource, string> = {
  broadcast: "Campanhas de template enviadas em lista. Uma linha por mensagem em message_logs.",
  flow: "Execuções de fluxo. A Meta não devolve entrega/leitura ligada à execução, por isso Entregue e Lido ficam em branco.",
  chat: "Mensagens do chat que não vieram de disparo em massa. Fluxo e envio manual usam a mesma rota de envio e ficam juntos aqui.",
};

/** Uma linha crua de `get_sending_metrics_by_source`. */
export interface SourceMetricRow {
  source: MetricSource;
  account_id: string | null;
  sent: number | null;
  delivered: number | null;
  read: number | null;
  failed: number | null;
  skipped: number | null;
  pending: number | null;
  tracks_delivery: boolean;
}

export interface OriginTotals {
  source: MetricSource;
  sent: number;
  /** null quando a origem não consegue rastrear entrega (fluxos). */
  delivered: number | null;
  read: number | null;
  failed: number;
  skipped: number;
  pending: number;
  /** enviadas + falhas + puladas + na fila */
  total: number;
  tracksDelivery: boolean;
}

const n = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function emptyTotals(source: MetricSource, tracksDelivery = true): OriginTotals {
  return {
    source,
    sent: 0,
    delivered: tracksDelivery ? 0 : null,
    read: tracksDelivery ? 0 : null,
    failed: 0,
    skipped: 0,
    pending: 0,
    total: 0,
    tracksDelivery,
  };
}

/**
 * Soma linhas de UMA origem. Mantém a invariante lido ≤ entregue ≤ enviado:
 * o banco pode devolver `delivered_at` preenchido numa linha ainda marcada
 * como pendente (corrida do webhook), e sem o clamp a taxa passava de 100%.
 */
export function sumRows(source: MetricSource, rows: SourceMetricRow[]): OriginTotals {
  const tracksDelivery = rows.length > 0 ? rows.every((r) => r.tracks_delivery) : true;
  const acc = emptyTotals(source, tracksDelivery);

  for (const r of rows) {
    acc.sent += n(r.sent);
    acc.failed += n(r.failed);
    acc.skipped += n(r.skipped);
    acc.pending += n(r.pending);
    if (tracksDelivery) {
      acc.delivered = n(acc.delivered) + n(r.delivered);
      acc.read = n(acc.read) + n(r.read);
    }
  }

  if (tracksDelivery) {
    acc.delivered = Math.min(n(acc.delivered), acc.sent);
    acc.read = Math.min(n(acc.read), n(acc.delivered));
  }
  acc.total = acc.sent + acc.failed + acc.skipped + acc.pending;
  return acc;
}

export const ALL_SOURCES: MetricSource[] = ["broadcast", "flow", "chat"];

/** Uma entrada por origem, sempre as três — zeradas quando não há dado. */
export function aggregateBySource(rows: SourceMetricRow[] | null | undefined): OriginTotals[] {
  const list = rows || [];
  return ALL_SOURCES.map((s) =>
    sumRows(
      s,
      list.filter((r) => r.source === s)
    )
  );
}

/**
 * Por conta do WhatsApp. Fluxos não têm conta (flow_executions não guarda
 * account_id), então ficam de fora — misturá-los na conta "sem conta
 * vinculada" inventaria um número que não existe.
 */
export function aggregateByAccount(
  rows: SourceMetricRow[] | null | undefined
): Map<string, OriginTotals[]> {
  const buckets = new Map<string, Map<MetricSource, SourceMetricRow[]>>();

  for (const r of rows || []) {
    if (r.source === "flow") continue;
    const key = r.account_id ?? "unknown";
    const bySource = buckets.get(key) || new Map<MetricSource, SourceMetricRow[]>();
    bySource.set(r.source, [...(bySource.get(r.source) || []), r]);
    buckets.set(key, bySource);
  }

  const out = new Map<string, OriginTotals[]>();
  for (const [account, bySource] of buckets) {
    out.set(
      account,
      [...bySource].map(([source, list]) => sumRows(source, list))
    );
  }
  return out;
}

/** Percentual sobre `whole`, ou null quando não há base (evita "0%" mentiroso). */
export function rate(part: number | null, whole: number): number | null {
  if (part === null || whole <= 0) return null;
  return (part / whole) * 100;
}

export function formatRate(part: number | null, whole: number): string {
  const r = rate(part, whole);
  return r === null ? "—" : `${Math.round(r)}%`;
}

export interface ProgressInput {
  /** total_leads do job: o alvo. Pode ser menor que o realizado em job antigo. */
  audience?: number | null;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  skipped?: number | null;
  pending?: number | null;
}

export interface ProgressBar {
  total: number;
  /** contagens acumulativas, já com clamp aplicado */
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  skipped: number;
  pending: number;
  /** segmentos DISJUNTOS da barra, em % do total — somam ≤ 100 */
  segments: {
    read: number;
    deliveredOnly: number;
    sentOnly: number;
    failed: number;
    skipped: number;
    pending: number;
  };
  /** % do alvo já processado (enviado + falha + pulado) */
  progressPct: number;
}

/**
 * Transforma os quatro números acumulativos em segmentos disjuntos de barra.
 *
 * Somar enviadas + entregues + lidas encheria a barra três vezes com a mesma
 * mensagem. O que a barra empilha é: lidas, entregues-mas-não-lidas,
 * enviadas-sem-confirmação, erros, puladas e fila.
 */
export function progressBar(input: ProgressInput): ProgressBar {
  const sent = Math.max(0, n(input.sent));
  const failed = Math.max(0, n(input.failed));
  const skipped = Math.max(0, n(input.skipped));
  const delivered = Math.min(Math.max(0, n(input.delivered)), sent);
  const read = Math.min(Math.max(0, n(input.read)), delivered);

  const processed = sent + failed + skipped;
  const audience = Math.max(0, n(input.audience));
  const pending =
    input.pending !== undefined && input.pending !== null
      ? Math.max(0, n(input.pending))
      : Math.max(0, audience - processed);
  const total = Math.max(audience, processed + pending);

  const pct = (v: number) => (total > 0 ? (v / total) * 100 : 0);

  return {
    total,
    sent,
    delivered,
    read,
    failed,
    skipped,
    pending,
    segments: {
      read: pct(read),
      deliveredOnly: pct(delivered - read),
      sentOnly: pct(sent - delivered),
      failed: pct(failed),
      skipped: pct(skipped),
      pending: pct(pending),
    },
    progressPct: total > 0 ? (processed / total) * 100 : 0,
  };
}

/**
 * Divergência entre o contador gravado em broadcast_jobs e a contagem real de
 * message_logs. O código antigo fazia Math.max entre os dois — o maior ganhava
 * e a divergência sumia. Aqui ela é devolvida para a tela poder mostrar.
 * Retorna null quando a diferença é irrelevante.
 */
export function counterDrift(jobCount: number, realCount: number): number | null {
  const diff = n(jobCount) - n(realCount);
  if (Math.abs(diff) < 10) return null;
  const base = Math.max(n(realCount), 1);
  if (Math.abs(diff) / base < 0.05) return null;
  return diff;
}
