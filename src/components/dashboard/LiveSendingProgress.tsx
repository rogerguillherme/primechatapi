import { useMemo } from "react";
import { PremiumCard } from "@/components/premium/PremiumCard";
import { Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useBroadcastProgress, useFlowProgress } from "@/hooks/use-sending-metrics";
import { SendingProgressBar } from "./SendingProgressBar";

/**
 * Progresso dos disparos em andamento, uma linha por disparo.
 *
 * A contagem vem agregada do Postgres (get_broadcast_progress /
 * get_flow_progress). A versão anterior puxava até 20.000 execuções de fluxo
 * para o navegador e agrupava em JavaScript — além de lento, o teto de linhas
 * do PostgREST fazia os números pararem de crescer em silêncio.
 */
const WINDOW_HOURS = 36;

export interface LiveBatchRow {
  id: string;
  name: string;
  source: "flow" | "campaign";
  startedAt: string | null;
  audience: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  skipped: number;
  pending: number;
  tracksDelivery: boolean;
  lastActivity: string | null;
}

export function useLiveSendingProgress() {
  const since = useMemo(() => new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000), []);
  const broadcasts = useBroadcastProgress(since, 100);
  const flows = useFlowProgress(since, 100);

  const rows = useMemo<LiveBatchRow[]>(() => {
    const out: LiveBatchRow[] = [];

    for (const j of broadcasts.data || []) {
      out.push({
        id: `job:${j.job_id}`,
        name: j.campaign_name || j.template_name || "Disparo",
        source: "campaign",
        startedAt: j.created_at,
        audience: j.audience,
        sent: j.sent,
        delivered: j.delivered,
        read: j.read,
        failed: j.failed,
        skipped: j.skipped,
        pending: j.pending,
        tracksDelivery: true,
        lastActivity: j.updated_at || j.created_at,
      });
    }

    for (const b of flows.data || []) {
      out.push({
        id: `flow:${b.flow_id}:${b.batch_started_at}`,
        name: b.flow_name || "Fluxo",
        source: "flow",
        startedAt: b.batch_started_at,
        audience: b.total,
        sent: b.sent,
        delivered: 0,
        read: 0,
        failed: b.failed,
        skipped: b.skipped,
        pending: b.pending,
        tracksDelivery: false,
        lastActivity: b.last_activity,
      });
    }

    return out
      .filter((r) => r.audience > 0 || r.sent > 0 || r.failed > 0)
      .sort((a, b) => {
        if ((b.pending > 0 ? 1 : 0) !== (a.pending > 0 ? 1 : 0)) return b.pending > 0 ? 1 : -1;
        return (b.startedAt || "").localeCompare(a.startedAt || "");
      });
  }, [broadcasts.data, flows.data]);

  return { data: rows, isLoading: broadcasts.isLoading || flows.isLoading };
}

function relativeTime(iso: string | null) {
  if (!iso) return "—";
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min} min atrás`;
  return `${Math.floor(min / 60)}h atrás`;
}

export function LiveSendingProgress() {
  const { data: rows, isLoading } = useLiveSendingProgress();

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => {
          acc.audience += r.audience;
          acc.sent += r.sent;
          acc.failed += r.failed;
          acc.skipped += r.skipped;
          acc.pending += r.pending;
          // fluxos não rastreiam entrega — somar 0 aqui manteria o número honesto
          acc.delivered += r.tracksDelivery ? r.delivered : 0;
          acc.read += r.tracksDelivery ? r.read : 0;
          return acc;
        },
        { audience: 0, sent: 0, delivered: 0, read: 0, failed: 0, skipped: 0, pending: 0 }
      ),
    [rows]
  );

  if (!isLoading && rows.length === 0) return null;

  const running = totals.pending > 0;
  const activeCount = rows.filter((r) => r.pending > 0).length;
  const hasFlowRow = rows.some((r) => !r.tracksDelivery);

  return (
    <PremiumCard className="p-5 sm:p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Activity size={16} className={cn(running ? "text-primary animate-pulse" : "text-emerald-500")} />
        <div>
          <h2 className="text-lg font-display font-bold">Envio em tempo real</h2>
          <p className="text-xs text-muted-foreground">
            {running
              ? `${activeCount} disparo(s) em andamento — atualiza a cada 5 segundos`
              : `Nenhum envio pendente nas últimas ${WINDOW_HOURS}h`}
          </p>
        </div>
      </div>

      <SendingProgressBar
        audience={totals.audience}
        sent={totals.sent}
        delivered={totals.delivered}
        read={totals.read}
        failed={totals.failed}
        skipped={totals.skipped}
        pending={totals.pending}
      />

      {hasFlowRow && (
        <p className="text-[10px] text-muted-foreground">
          Entregues e lidas contam só os disparos em lista: fluxos não guardam o id da mensagem, então
          a Meta não consegue devolver o status por execução.
        </p>
      )}

      <div className="space-y-1.5">
        {rows.slice(0, 5).map((r) => (
          <div key={r.id} className="rounded-lg border border-border/50 bg-card/40 px-3 py-2 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium truncate">{r.name}</p>
              <span className="text-[10px] text-muted-foreground shrink-0">
                {r.source === "flow" ? "fluxo" : "campanha"}
                {r.startedAt
                  ? ` · ${format(new Date(r.startedAt), "dd/MM HH:mm", { locale: ptBR })}`
                  : ""}
              </span>
            </div>
            <SendingProgressBar
              audience={r.audience}
              sent={r.sent}
              delivered={r.delivered}
              read={r.read}
              failed={r.failed}
              skipped={r.skipped}
              pending={r.pending}
              tracksDelivery={r.tracksDelivery}
              compact
            />
            <p className="text-[10px] text-muted-foreground">
              última atividade {relativeTime(r.lastActivity)}
            </p>
          </div>
        ))}
        {rows.length > 5 && (
          <p className="text-[10px] text-muted-foreground text-center pt-1">
            +{(rows.length - 5).toLocaleString("pt-BR")} outros disparos não exibidos aqui
          </p>
        )}
      </div>
    </PremiumCard>
  );
}
