import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PremiumCard } from "@/components/premium/PremiumCard";
import { Activity, Send, Clock, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Statuses that mean the message for this execution already left the system. */
const SENT_STATUSES = new Set(["waiting_reply", "completed", "finished", "done"]);
const PENDING_STATUSES = new Set(["waiting_delay", "pending", "queued", "scheduled", "running"]);
const FAILED_STATUSES = new Set(["failed", "error"]);
const SKIPPED_STATUSES = new Set(["cancelled", "canceled", "skipped", "stopped"]);

export interface LiveBatchRow {
  flowId: string;
  name: string;
  total: number;
  sent: number;
  pending: number;
  failed: number;
  skipped: number;
  lastActivity: string | null;
}

/**
 * Real-time progress of ongoing sends (flow-based batches).
 * Refreshes every 5s while there is anything pending, 30s otherwise.
 */
export function useLiveSendingProgress() {
  const { user } = useAuth();

  return useQuery<LiveBatchRow[]>({
    queryKey: ["live-sending-progress", user?.id],
    enabled: !!user,
    refetchInterval: (q) => {
      const rows = (q.state.data as LiveBatchRow[] | undefined) || [];
      return rows.some((r) => r.pending > 0) ? 5_000 : 30_000;
    },
    staleTime: 4_000,
    queryFn: async () => {
      if (!user) return [];
      const sinceIso = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();

      const { data: flows } = await supabase
        .from("flows")
        .select("id, name")
        .eq("user_id", user.id);
      const flowIds = (flows || []).map((f) => f.id);
      if (flowIds.length === 0) return [];

      const { data: execs } = await supabase
        .from("flow_executions")
        .select("flow_id, status, updated_at")
        .in("flow_id", flowIds)
        .gte("started_at", sinceIso)
        .limit(20000);

      const names = new Map((flows || []).map((f) => [f.id, f.name] as const));
      const byFlow = new Map<string, LiveBatchRow>();

      for (const e of execs || []) {
        const row =
          byFlow.get(e.flow_id) ||
          ({
            flowId: e.flow_id,
            name: names.get(e.flow_id) || "Fluxo",
            total: 0,
            sent: 0,
            pending: 0,
            failed: 0,
            skipped: 0,
            lastActivity: null,
          } as LiveBatchRow);

        const st = (e.status || "").toLowerCase();
        row.total++;
        if (SENT_STATUSES.has(st)) row.sent++;
        else if (FAILED_STATUSES.has(st)) row.failed++;
        else if (SKIPPED_STATUSES.has(st)) row.skipped++;
        else if (PENDING_STATUSES.has(st)) row.pending++;

        if (e.updated_at && (!row.lastActivity || e.updated_at > row.lastActivity)) {
          row.lastActivity = e.updated_at;
        }
        byFlow.set(e.flow_id, row);
      }

      return Array.from(byFlow.values())
        .filter((r) => r.total > 0)
        .sort((a, b) => b.pending - a.pending || b.total - a.total);
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

  return (
    <PremiumCard className="p-5 sm:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Activity size={16} className={cn(running ? "text-primary animate-pulse" : "text-emerald-500")} />
          <div>
            <h2 className="text-lg font-display font-bold">Envio em tempo real</h2>
            <p className="text-xs text-muted-foreground">
              {running
                ? "Disparo em andamento — atualiza a cada 5 segundos"
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
        {rows.map((r) => {
          const rowPct = r.total > 0 ? Math.min(100, (r.sent / r.total) * 100) : 0;
          return (
            <div key={r.flowId} className="rounded-lg border border-border/50 bg-card/40 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium truncate">{r.name}</p>
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
                {r.skipped.toLocaleString("pt-BR")} pulados · última atividade {relativeTime(r.lastActivity)}
              </p>
            </div>
          );
        })}
      </div>
    </PremiumCard>
  );
}
