import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PremiumCard } from "@/components/premium/PremiumCard";
import { Activity, Send, Clock, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

/** Statuses that mean the message for this execution already left the system. */
const SENT_STATUSES = new Set(["waiting_reply", "completed", "finished", "done"]);
const PENDING_STATUSES = new Set(["waiting_delay", "pending", "queued", "scheduled", "running"]);
const FAILED_STATUSES = new Set(["failed", "error"]);
const SKIPPED_STATUSES = new Set(["cancelled", "canceled", "skipped", "stopped"]);

/** Gap (ms) between executions that starts a new batch of the same flow. */
const BATCH_GAP_MS = 30 * 60 * 1000;

export interface LiveBatchRow {
  /** Unique id per disparo (batch), not per flow. */
  id: string;
  /** Flow or campaign name */
  name: string;
  /** "Lista" name when the disparo came from a broadcast job */
  listName: string | null;
  source: "flow" | "campaign";
  startedAt: string | null;
  total: number;
  sent: number;
  delivered: number;
  read: number;
  pending: number;
  failed: number;
  skipped: number;
  lastActivity: string | null;
}

/**
 * Real-time progress of ongoing sends. Each disparo (batch) is a separate row:
 * broadcast campaigns come from `broadcast_jobs`, and flow executions are
 * clustered into batches by their start time so two disparos of the same flow
 * never get merged into one.
 * Refreshes every 5s while there is anything pending, 30s otherwise.
 */
export function useLiveSendingProgress() {
  const { user } = useAuth();

  return useQuery<LiveBatchRow[]>({
    queryKey: ["live-sending-progress", user?.id],
    enabled: !!user,
    staleTime: 4_000,
    placeholderData: (prev) => prev,
    refetchInterval: (q) => {
      const rows = (q.state.data as LiveBatchRow[] | undefined) || [];
      return rows.some((r) => r.pending > 0) ? 5_000 : 30_000;
    },
    queryFn: async () => {
      if (!user) return [];
      const sinceIso = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();

      const [flowsRes, jobsRes] = await Promise.all([
        supabase.from("flows").select("id, name").eq("user_id", user.id),
        supabase
          .from("broadcast_jobs")
          .select(
            "id, campaign_name, template_name, total_leads, sent_count, delivered_count, read_count, error_count, status, created_at, updated_at"
          )
          .eq("user_id", user.id)
          .gte("created_at", sinceIso)
          .order("created_at", { ascending: false })
          .limit(100),
      ]);

      const rows: LiveBatchRow[] = [];

      // 1) Campanhas (disparos em lista) — cada job é um disparo separado
      for (const j of jobsRes.data || []) {
        const sent = j.sent_count || 0;
        const failed = j.error_count || 0;
        const total = j.total_leads || sent + failed;
        rows.push({
          id: `job:${j.id}`,
          name: (j as any).campaign_name || j.template_name || "Disparo",
          listName: (j as any).campaign_name || j.template_name || null,
          source: "campaign",
          startedAt: j.created_at,
          total,
          sent,
          delivered: j.delivered_count || 0,
          read: j.read_count || 0,
          pending: Math.max(0, total - sent - failed),
          failed,
          skipped: 0,
          lastActivity: j.updated_at || j.created_at,
        });
      }

      // 2) Fluxos — agrupados por lote (cluster de started_at)
      const flowIds = (flowsRes.data || []).map((f) => f.id);
      if (flowIds.length > 0) {
        const { data: execs } = await supabase
          .from("flow_executions")
          .select("flow_id, status, started_at, updated_at")
          .in("flow_id", flowIds)
          .gte("started_at", sinceIso)
          .order("started_at", { ascending: true })
          .limit(20000);

        const names = new Map((flowsRes.data || []).map((f) => [f.id, f.name] as const));
        const byFlow = new Map<string, typeof execs>();
        for (const e of execs || []) {
          const list = byFlow.get(e.flow_id) || [];
          list.push(e);
          byFlow.set(e.flow_id, list as any);
        }

        for (const [flowId, list] of byFlow) {
          let batch: LiveBatchRow | null = null;
          let lastStart = 0;

          const flush = () => {
            if (batch && batch.total > 0) rows.push(batch);
          };

          for (const e of list || []) {
            const startMs = new Date(e.started_at).getTime();
            if (!batch || startMs - lastStart > BATCH_GAP_MS) {
              flush();
              batch = {
                id: `flow:${flowId}:${e.started_at}`,
                name: names.get(flowId) || "Fluxo",
                listName: null,
                source: "flow",
                startedAt: e.started_at,
                total: 0,
                sent: 0,
                delivered: 0,
                read: 0,
                pending: 0,
                failed: 0,
                skipped: 0,
                lastActivity: null,
              };
            }
            lastStart = startMs;

            const st = (e.status || "").toLowerCase();
            batch.total++;
            if (SENT_STATUSES.has(st)) batch.sent++;
            else if (FAILED_STATUSES.has(st)) batch.failed++;
            else if (SKIPPED_STATUSES.has(st)) batch.skipped++;
            else if (PENDING_STATUSES.has(st)) batch.pending++;

            if (e.updated_at && (!batch.lastActivity || e.updated_at > batch.lastActivity)) {
              batch.lastActivity = e.updated_at;
            }
          }
          flush();
        }
      }

      return rows
        .filter((r) => r.total > 0)
        .sort((a, b) => {
          if ((b.pending > 0 ? 1 : 0) !== (a.pending > 0 ? 1 : 0)) return b.pending > 0 ? 1 : -1;
          return (b.startedAt || "").localeCompare(a.startedAt || "");
        });
    },
  });
}

function relativeTime(iso: string | null) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min} min atrás`;
  const h = Math.floor(min / 60);
  return `${h}h atrás`;
}

export function LiveSendingProgress() {
  const { data, isLoading } = useLiveSendingProgress();
  const rows = data || [];

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => {
          acc.total += r.total;
          acc.sent += r.sent;
          acc.pending += r.pending;
          acc.failed += r.failed;
          acc.skipped += r.skipped;
          return acc;
        },
        { total: 0, sent: 0, pending: 0, failed: 0, skipped: 0 }
      ),
    [rows]
  );

  if (!isLoading && rows.length === 0) return null;

  const pct = totals.total > 0 ? Math.min(100, (totals.sent / totals.total) * 100) : 0;
  const running = totals.pending > 0;
  const activeCount = rows.filter((r) => r.pending > 0).length;

  return (
    <PremiumCard className="p-5 sm:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Activity size={16} className={cn(running ? "text-primary animate-pulse" : "text-emerald-500")} />
          <div>
            <h2 className="text-lg font-display font-bold">Envio em tempo real</h2>
            <p className="text-xs text-muted-foreground">
              {running
                ? `${activeCount} disparo(s) em andamento — atualiza a cada 5 segundos`
                : "Nenhum envio pendente nas últimas 36h"}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-display font-bold tabular-nums leading-none">
            {totals.sent.toLocaleString("pt-BR")}
            <span className="text-sm text-muted-foreground font-normal">
              {" "}/ {totals.total.toLocaleString("pt-BR")}
            </span>
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">{pct.toFixed(1)}% enviados</p>
        </div>
      </div>

      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-700",
            running ? "bg-primary" : "bg-emerald-500"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Enviados", value: totals.sent, icon: Send, color: "text-primary" },
          { label: "Na fila", value: totals.pending, icon: Clock, color: "text-amber-500" },
          { label: "Falhas", value: totals.failed, icon: AlertTriangle, color: "text-destructive" },
          { label: "Pulados", value: totals.skipped, icon: CheckCircle2, color: "text-muted-foreground" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border/60 bg-card/40 p-3">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{s.label}</p>
              <s.icon size={14} className={cn(s.color)} />
            </div>
            <p className="text-2xl font-display font-bold tabular-nums leading-none">
              {s.value.toLocaleString("pt-BR")}
            </p>
          </div>
        ))}
      </div>

      <div className="space-y-1.5">
        {rows.slice(0, 5).map((r) => {
          const rowPct = r.total > 0 ? Math.min(100, (r.sent / r.total) * 100) : 0;
          return (
            <div key={r.id} className="rounded-lg border border-border/50 bg-card/40 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {r.name}
                    {r.source === "campaign" && r.listName ? (
                      <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">(lista)</span>
                    ) : null}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {r.startedAt
                      ? `início ${format(new Date(r.startedAt), "dd/MM HH:mm", { locale: ptBR })}`
                      : "—"}
                    {r.source === "flow" ? " · fluxo" : " · campanha"}
                  </p>
                </div>
                <span className="text-[11px] tabular-nums text-muted-foreground shrink-0">
                  {r.sent.toLocaleString("pt-BR")}/{r.total.toLocaleString("pt-BR")} ({rowPct.toFixed(0)}%)
                </span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-700",
                    r.pending > 0 ? "bg-primary animate-pulse" : "bg-emerald-500"
                  )}
                  style={{ width: `${rowPct}%` }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                {r.pending.toLocaleString("pt-BR")} na fila · {r.failed.toLocaleString("pt-BR")} falhas ·{" "}
                {r.skipped.toLocaleString("pt-BR")} pulados
                {r.source === "campaign"
                  ? ` · ${r.delivered.toLocaleString("pt-BR")} entregues · ${r.read.toLocaleString("pt-BR")} lidos`
                  : ""}{" "}
                · última atividade {relativeTime(r.lastActivity)}
              </p>
            </div>
          );
        })}
        {rows.length > 5 && (
          <p className="text-[10px] text-muted-foreground text-center pt-1">
            +{(rows.length - 5).toLocaleString("pt-BR")} outros disparos não exibidos aqui
          </p>
        )}
      </div>
    </PremiumCard>
  );
}
