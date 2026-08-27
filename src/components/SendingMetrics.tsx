import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Send, RefreshCw, ChevronDown, ChevronRight,
  Loader2, Zap, Download, AlertTriangle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { SendingProgressBar } from "@/components/dashboard/SendingProgressBar";
import {
  useBroadcastProgress,
  useFlowProgress,
} from "@/hooks/use-sending-metrics";
import { counterDrift } from "@/lib/sendingMetrics";

function getAvatarColor(name: string) {
  const colors = ["bg-emerald-600", "bg-violet-600", "bg-amber-600", "bg-rose-600", "bg-cyan-600", "bg-indigo-600"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}
function getInitials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

const IN_PROGRESS_STATUSES = new Set(["processing", "queued", "running", "pending", "scheduled", "paused"]);

/** Um disparo na lista: campanha de lista ou lote de fluxo. */
interface DispatchGroup {
  key: string;
  label: string;
  type: "broadcast" | "flow";
  date: string;
  status?: string | null;
  inProgress: boolean;
  audience: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  skipped: number;
  pending: number;
  tracksDelivery: boolean;
  /** divergência entre o contador do broadcast_jobs e a contagem real */
  drift: number | null;
  jobId?: string;
  flowId?: string;
  batchStart?: string;
  batchEnd?: string;
}

export function SendingMetrics() {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const { data: broadcasts, isLoading: loadingBroadcasts } = useBroadcastProgress();
  const { data: flowBatches, isLoading: loadingFlows } = useFlowProgress();

  const handleRefresh = () => {
    setRefreshing(true);
    for (const key of ["broadcast-progress", "flow-progress"]) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
    setTimeout(() => setRefreshing(false), 800);
  };

  const dispatches = useMemo<DispatchGroup[]>(() => {
    const groups: DispatchGroup[] = [];

    for (const job of broadcasts || []) {
      const dateStr = format(new Date(job.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR });
      groups.push({
        key: `job:${job.job_id}`,
        label:
          job.campaign_name ||
          (job.template_name ? `Disparo ${dateStr} — ${job.template_name}` : `Disparo ${dateStr}`),
        type: "broadcast",
        date: job.created_at,
        status: job.status,
        inProgress: IN_PROGRESS_STATUSES.has((job.status || "").toLowerCase()),
        audience: job.audience,
        sent: job.sent,
        delivered: job.delivered,
        read: job.read,
        failed: job.failed,
        skipped: job.skipped,
        pending: job.pending,
        tracksDelivery: true,
        drift: counterDrift(job.job_delivered, job.delivered),
        jobId: job.job_id,
      });
    }

    for (const batch of flowBatches || []) {
      const dateStr = format(new Date(batch.batch_started_at), "dd/MM/yyyy HH:mm", { locale: ptBR });
      groups.push({
        key: `flow:${batch.flow_id}:${batch.batch_started_at}`,
        label: `⚡ ${batch.flow_name} — ${dateStr}`,
        type: "flow",
        date: batch.batch_started_at,
        status: batch.pending > 0 ? "processing" : "completed",
        inProgress: batch.pending > 0,
        audience: batch.total,
        sent: batch.sent,
        delivered: 0,
        read: 0,
        failed: batch.failed,
        skipped: batch.skipped,
        pending: batch.pending,
        tracksDelivery: false,
        drift: null,
        flowId: batch.flow_id,
        batchStart: batch.batch_started_at,
        batchEnd: batch.last_activity || batch.batch_started_at,
      });
    }

    return groups.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [broadcasts, flowBatches]);

  const loadingDispatches = loadingBroadcasts || loadingFlows;

  // Só dois grupos: o que saiu para uma lista e o que saiu sozinho.
  // Fluxo disparado por webhook e envio automático são a mesma coisa para
  // quem olha o histórico — nenhum dos dois foi você quem mandou na mão.
  const byKind = useMemo(() => {
    const listas = dispatches.filter((d) => d.type === "broadcast");
    const automacao = dispatches.filter((d) => d.type !== "broadcast");
    return { listas, automacao };
  }, [dispatches]);

  const [kind, setKind] = useState<"listas" | "automacao">("listas");
  const current = kind === "listas" ? byKind.listas : byKind.automacao;
  const totals = useMemo(() => sumDispatches(current), [current]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex rounded-lg border border-border p-0.5 bg-muted/40">
          {([
            ["listas", "Listas", byKind.listas.length],
            ["automacao", "Automação", byKind.automacao.length],
          ] as const).map(([value, label, count]) => (
            <button
              key={value}
              onClick={() => { setKind(value); setExpandedKey(null); }}
              className={cn(
                "px-3 py-1.5 text-sm rounded-md transition-colors flex items-center gap-1.5",
                kind === value
                  ? "bg-background shadow-sm font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
              <span className="text-[11px] tabular-nums opacity-60">{count}</span>
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} className="gap-1.5">
          <RefreshCw size={14} className={cn(refreshing && "animate-spin")} />
          Atualizar
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Send size={16} />
            {kind === "listas" ? "Disparos para listas" : "Envios automáticos"}
          </CardTitle>
          <p className="text-[11px] text-muted-foreground leading-snug">
            {kind === "listas"
              ? "Envios em massa que você disparou para uma lista de contatos."
              : "Fluxos e gatilhos de webhook — o que o sistema enviou sozinho."}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <SendingProgressBar
            audience={totals.audience}
            sent={totals.sent}
            delivered={totals.delivered}
            read={totals.read}
            failed={totals.failed}
            skipped={totals.skipped}
            pending={totals.pending}
            tracksDelivery={kind === "listas"}
          />

          {loadingDispatches ? (
            <p className="text-sm text-muted-foreground text-center py-8">Carregando...</p>
          ) : !current.length ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {kind === "listas"
                ? "Nenhum disparo para lista registrado."
                : "Nenhum envio automático registrado."}
            </p>
          ) : (
            <ScrollArea className="max-h-[560px] -mx-6">
              <div className="divide-y divide-border">
                {current.map((d) => (
                  <DispatchItem
                    key={d.key}
                    group={d}
                    isExpanded={expandedKey === d.key}
                    onToggle={() => setExpandedKey(expandedKey === d.key ? null : d.key)}
                  />
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Soma um conjunto de disparos para a barra do topo. */
function sumDispatches(list: DispatchGroup[]) {
  return list.reduce(
    (acc, d) => ({
      audience: acc.audience + (d.audience || 0),
      sent: acc.sent + (d.sent || 0),
      delivered: acc.delivered + (d.delivered || 0),
      read: acc.read + (d.read || 0),
      failed: acc.failed + (d.failed || 0),
      skipped: acc.skipped + (d.skipped || 0),
      pending: acc.pending + (d.pending || 0),
    }),
    { audience: 0, sent: 0, delivered: 0, read: 0, failed: 0, skipped: 0, pending: 0 },
  );
}

/* ── Um disparo, com barra de progresso e lista de leads ── */
function DispatchItem({ group, isExpanded, onToggle }: {
  group: DispatchGroup;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const { data: leads, isLoading } = useQuery({
    queryKey: ["dispatch-leads", group.key],
    enabled: isExpanded,
    staleTime: 60_000,
    queryFn: async () => {
      let leadIds: string[] = [];

      if (group.type === "broadcast" && group.jobId) {
        const { data } = await supabase
          .from("broadcast_jobs")
          .select("lead_ids")
          .eq("id", group.jobId)
          .maybeSingle();
        leadIds = data?.lead_ids || [];
      } else if (group.flowId && group.batchStart) {
        // Só a lista visual do painel — 500 é teto de exibição, não de contagem
        // (as contagens vêm agregadas do banco).
        const { data } = await supabase
          .from("flow_executions")
          .select("lead_id")
          .eq("flow_id", group.flowId)
          .gte("started_at", group.batchStart)
          .lte("started_at", group.batchEnd || group.batchStart)
          .limit(500);
        leadIds = [...new Set((data || []).map((e) => e.lead_id).filter(Boolean))];
      }

      const all: { id: string; name: string; phone: string }[] = [];
      for (let i = 0; i < leadIds.length; i += 100) {
        const { data } = await supabase
          .from("leads")
          .select("id, name, phone")
          .in("id", leadIds.slice(i, i + 100));
        if (data) all.push(...data);
      }
      return all;
    },
  });

  return (
    <div>
      <button
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent/30 transition-colors text-left"
        onClick={onToggle}
      >
        <span className="text-muted-foreground shrink-0">
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center gap-2">
            {group.type === "flow" && <Zap size={12} className="text-amber-500 shrink-0" />}
            <p className="text-sm font-medium truncate">{group.label}</p>
            {group.inProgress && (
              <Badge className="text-[10px] bg-amber-500/15 text-amber-600 border-amber-500/30 gap-1">
                <Loader2 size={10} className="animate-spin" />
                Em andamento
              </Badge>
            )}
            {group.status === "paused" && (
              <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-500/40">Pausado</Badge>
            )}
          </div>
          <SendingProgressBar
            audience={group.audience}
            sent={group.sent}
            delivered={group.delivered}
            read={group.read}
            failed={group.failed}
            skipped={group.skipped}
            pending={group.pending}
            tracksDelivery={group.tracksDelivery}
            compact
          />
        </div>
      </button>

      {isExpanded && (
        <div className="px-4 pb-3 pl-11 bg-muted/20 space-y-3 pt-1">
          <SendingProgressBar
            audience={group.audience}
            sent={group.sent}
            delivered={group.delivered}
            read={group.read}
            failed={group.failed}
            skipped={group.skipped}
            pending={group.pending}
            tracksDelivery={group.tracksDelivery}
          />

          {group.drift !== null && (
            <p className="flex items-start gap-1.5 text-[10px] text-amber-600">
              <AlertTriangle size={12} className="shrink-0 mt-px" />
              O contador salvo no disparo marca {group.drift > 0 ? "+" : ""}
              {group.drift.toLocaleString("pt-BR")} entregues em relação à contagem por mensagem
              mostrada acima. A tela usa a contagem por mensagem (message_logs).
            </p>
          )}

          {group.type === "flow" && (
            <p className="text-[10px] text-muted-foreground">
              Fluxos não registram o id da mensagem enviada, então entrega e leitura não podem ser
              atribuídas ao lote — aparecem em branco de propósito.
            </p>
          )}

          {(group.failed > 0 || group.skipped > 0) && <ExportErrorsButton group={group} />}

          <div className="space-y-1">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Leads do disparo</p>
            {isLoading ? (
              <div className="flex items-center gap-2 py-3 justify-center text-muted-foreground">
                <Loader2 size={14} className="animate-spin" />
                <span className="text-xs">Carregando leads...</span>
              </div>
            ) : !leads?.length ? (
              <p className="text-xs text-muted-foreground py-2">Nenhum lead encontrado.</p>
            ) : (
              <ScrollArea className="max-h-[200px]">
                <div className="space-y-0.5">
                  {leads.map((lead) => (
                    <div key={lead.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent/30">
                      <Avatar className="w-6 h-6">
                        <AvatarFallback className={cn(getAvatarColor(lead.name), "text-[10px] text-white")}>
                          {getInitials(lead.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium truncate">{lead.name}</p>
                      </div>
                      <span className="text-[10px] text-muted-foreground font-mono">{lead.phone}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Exporta os leads com erro em CSV ── */
function ExportErrorsButton({ group }: { group: DispatchGroup }) {
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    setLoading(true);
    try {
      let rows: { name: string; phone: string; error: string }[] = [];

      if (group.type === "flow" && group.flowId && group.batchStart) {
        const { data: execs } = await supabase
          .from("flow_executions")
          .select("lead_id, status, metadata")
          .eq("flow_id", group.flowId)
          .gte("started_at", group.batchStart)
          .lte("started_at", group.batchEnd || group.batchStart)
          .in("status", ["failed", "error", "cancelled", "canceled", "skipped", "stopped"]);

        const leadIds = [...new Set((execs || []).map((e) => e.lead_id).filter(Boolean))];
        const leadMap = new Map<string, { name: string; phone: string }>();
        for (let i = 0; i < leadIds.length; i += 100) {
          const { data } = await supabase.from("leads").select("id, name, phone").in("id", leadIds.slice(i, i + 100));
          (data || []).forEach((l) => leadMap.set(l.id, { name: l.name, phone: l.phone }));
        }
        rows = (execs || []).map((e) => {
          const lead = leadMap.get(e.lead_id);
          const meta = (e.metadata || {}) as Record<string, string>;
          const cancelled = ["cancelled", "canceled", "skipped", "stopped"].includes(e.status);
          return {
            name: lead?.name || "",
            phone: lead?.phone || "",
            error: cancelled
              ? meta.cancel_reason || "Cancelado"
              : meta.last_error || meta.error || "Falhou",
          };
        });
      } else if (group.jobId) {
        const { data: logs } = await supabase
          .from("message_logs")
          .select("phone, lead_id, error_message, error_code, status")
          .eq("job_id", group.jobId)
          .in("status", [
            "failed", "error", "blocked_by_meta", "payment_issue",
            "rate_limited", "invalid_number", "skipped",
          ]);

        const leadIds = [...new Set((logs || []).map((l) => l.lead_id).filter(Boolean) as string[])];
        const leadMap = new Map<string, string>();
        for (let i = 0; i < leadIds.length; i += 100) {
          const { data } = await supabase.from("leads").select("id, name").in("id", leadIds.slice(i, i + 100));
          (data || []).forEach((l) => leadMap.set(l.id, l.name));
        }
        rows = (logs || []).map((l) => ({
          name: (l.lead_id && leadMap.get(l.lead_id)) || "",
          phone: l.phone || "",
          error: [l.status, l.error_code, l.error_message].filter(Boolean).join(" — ") || "Falhou",
        }));
      }

      if (rows.length === 0) {
        alert("Nenhum erro detalhado encontrado.");
        return;
      }

      const escape = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
      const csv = [
        ["Nome", "Telefone", "Erro"].map(escape).join(","),
        ...rows.map((r) => [r.name, r.phone, r.error].map(escape).join(",")),
      ].join("\n");

      const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `erros-${group.key.replace(/[^a-zA-Z0-9-]/g, "_")}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExport} disabled={loading}>
      {loading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
      Exportar erros ({(group.failed + group.skipped).toLocaleString("pt-BR")})
    </Button>
  );
}
