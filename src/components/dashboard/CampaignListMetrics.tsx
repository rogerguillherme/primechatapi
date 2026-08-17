import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ChevronDown, ChevronRight, MousePointerClick, Pencil, Check, X, RotateCcw, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

// WhatsApp Cloud API pricing (USD) — Brazil
export const PRICING = {
  utility: 0.008,
  marketing: 0.0625,
  authentication: 0.0315,
};
export const USD_TO_BRL = 5.2;
const WINDOW_MS = 24 * 60 * 60 * 1000;

export function inferCategory(cat: string | null | undefined): "utility" | "marketing" | "authentication" {
  const c = (cat || "").toLowerCase();
  if (c.includes("util")) return "utility";
  if (c.includes("auth")) return "authentication";
  return "marketing";
}

export interface CampaignListRow {
  id: string;
  /** Display name: custom name when set, template name otherwise */
  name: string;
  /** Custom name saved by the user (null when not set) */
  customName: string | null;
  /** Original template name */
  templateName: string | null;
  date: string;
  status?: string | null;
  total: number;
  sent: number;
  delivered: number;
  read: number;
  errors: number;
  /** Leads que responderam depois do disparo */
  replies: number;
  replyRate: number;
  deliveryRate: number;
  readRate: number;

  /** Sends that actually opened a new 24h conversation (paid) */
  billable: number;
  /** Sends delivered inside an already-open 24h window (free) */
  freeInWindow: number;
  costUsd: number;
  costBrl: number;
  category: "utility" | "marketing" | "authentication";
  links: any[];
  totalClicks: number;
  clickRate: number;
}

export interface CampaignListMetricsResult {
  rows: CampaignListRow[];
  totals: {
    sent: number;
    delivered: number;
    read: number;
    errors: number;
    replies: number;

    billable: number;
    freeInWindow: number;
    costUsd: number;
    costBrl: number;
  };
}

/**
 * Per-list (per campaign) metrics with billing that only counts PAID messages:
 * sends made while the lead's 24h customer-service window was already open are
 * free on WhatsApp Cloud API and are discounted from the cost.
 */
export function useCampaignListMetrics(startDate?: Date, endDate?: Date) {
  const { user } = useAuth();

  const query = useQuery<CampaignListMetricsResult | null>({

    queryKey: [
      "campaign-list-metrics",
      user?.id,
      startDate?.toISOString() ?? "all",
      endDate?.toISOString() ?? "all",
    ],
    enabled: !!user,
    staleTime: 8_000,
    placeholderData: (prev) => prev,
    // Acompanha a evolução em tempo quase real quando há disparo em andamento
    refetchInterval: (q) => {
      const rows = (q.state.data as CampaignListMetricsResult | null)?.rows || [];
      const active = rows.some((r) =>
        ["running", "processing", "queued", "pending", "scheduled", "paused"].includes(
          (r.status || "").toLowerCase()
        )
      );
      return active ? 10_000 : 60_000;
    },


    queryFn: async () => {
      if (!user) return null;

      let jobsQuery = supabase
        .from("broadcast_jobs")
        .select(
          "id, campaign_name, template_id, template_name, total_leads, sent_count, delivered_count, read_count, error_count, created_at, status"
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(500);
      if (startDate) jobsQuery = jobsQuery.gte("created_at", startDate.toISOString());
      if (endDate) jobsQuery = jobsQuery.lte("created_at", endDate.toISOString());

      const [jobsRes, tplRes] = await Promise.all([
        jobsQuery,
        supabase.from("chat_templates").select("id, category").eq("user_id", user.id),
      ]);

      const jobs = jobsRes.data || [];
      const tplCat = new Map((tplRes.data || []).map((t) => [t.id, inferCategory(t.category)]));
      const jobIds = jobs.map((j) => j.id);

      // Clicks + billing logs in parallel
      const [clicksRes, logsRes] = await Promise.all([
        jobIds.length > 0
          ? supabase
              .from("click_tracking_links")
              .select("campaign_id, original_url, short_code, click_count")
              .in("campaign_id", jobIds)
          : Promise.resolve({ data: [] as any[] }),
        jobIds.length > 0
          ? supabase
              .from("message_logs")
              .select("job_id, lead_id, status, sent_at, created_at")
              .eq("user_id", user.id)
              .in("job_id", jobIds)
              .limit(8000)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      const clicks = clicksRes.data || [];
      const clicksByJob = new Map<string, any[]>();
      for (const c of clicks) {
        const list = clicksByJob.get(c.campaign_id) || [];
        list.push(c);
        clicksByJob.set(c.campaign_id, list);
      }

      const logs = logsRes.data || [];

      // Leads' last inbound timestamp → 24h window reference (parallel chunks)
      const leadIds = Array.from(new Set(logs.map((l: any) => l.lead_id).filter(Boolean)));
      const inboundByLead = new Map<string, string | null>();
      const chunks: string[][] = [];
      for (let i = 0; i < leadIds.length; i += 1000) chunks.push(leadIds.slice(i, i + 1000) as string[]);
      const leadResults = await Promise.all(
        chunks.map((chunk) => supabase.from("leads").select("id, last_inbound_at").in("id", chunk))
      );
      for (const res of leadResults) {
        for (const l of res.data || []) inboundByLead.set(l.id, l.last_inbound_at);
      }


      const OK = new Set(["sent", "accepted", "delivered", "read"]);
      const perJob = new Map<
        string,
        { billable: number; free: number; okTotal: number; leads: Set<string> }
      >();
      for (const log of logs) {
        if (!OK.has((log.status || "").toLowerCase())) continue;
        const agg =
          perJob.get(log.job_id) || { billable: 0, free: 0, okTotal: 0, leads: new Set<string>() };
        agg.okTotal++;
        if (log.lead_id) agg.leads.add(log.lead_id);
        const sentAt = new Date(log.sent_at || log.created_at).getTime();
        const inbound = log.lead_id ? inboundByLead.get(log.lead_id) : null;
        const inWindow =
          !!inbound && sentAt - new Date(inbound).getTime() >= 0 && sentAt - new Date(inbound).getTime() <= WINDOW_MS;
        if (inWindow) agg.free++;
        else agg.billable++;
        perJob.set(log.job_id, agg);
      }


      const rows: CampaignListRow[] = jobs.map((j) => {
        const sent = j.sent_count || 0;
        const delivered = j.delivered_count || 0;
        const read = j.read_count || 0;
        const errors = j.error_count || 0;
        const cat = (j.template_id && tplCat.get(j.template_id)) || "marketing";
        const rate = PRICING[cat];
        const agg = perJob.get(j.id);
        const billable = agg ? agg.billable : sent;
        const freeInWindow = agg ? agg.free : 0;
        const costUsd = billable * rate;
        const links = clicksByJob.get(j.id) || [];
        const totalClicks = links.reduce((s, l) => s + (l.click_count || 0), 0);
        // Respostas: leads do disparo com inbound posterior ao início da campanha
        const jobStart = new Date(j.created_at).getTime();
        let replies = 0;
        if (agg) {
          for (const leadId of agg.leads) {
            const inbound = inboundByLead.get(leadId);
            if (inbound && new Date(inbound).getTime() >= jobStart) replies++;
          }
        }
        return {
          id: j.id,
          name: (j as any).campaign_name || j.template_name || "Disparo",
          customName: (j as any).campaign_name || null,
          templateName: j.template_name || null,
          date: j.created_at,
          status: j.status,
          total: j.total_leads || 0,
          sent,
          delivered,
          read,
          errors,
          replies,
          replyRate: sent > 0 ? (replies / sent) * 100 : 0,
          deliveryRate: sent > 0 ? (delivered / sent) * 100 : 0,
          readRate: sent > 0 ? (read / sent) * 100 : 0,

          billable,
          freeInWindow,
          costUsd,
          costBrl: costUsd * USD_TO_BRL,
          category: cat,
          links,
          totalClicks,
          clickRate: sent > 0 ? (totalClicks / sent) * 100 : 0,
        };
      });

      // ---------------------------------------------------------------
      // Disparos por FLUXO (a maioria dos envios reais do sistema).
      // broadcast_jobs cobre só as campanhas de template em lista; os
      // envios disparados por fluxo vivem em flow_executions + chat_messages.
      // Agrupamos as execuções em lotes (gap de 30min) para que dois
      // disparos do mesmo fluxo não sejam somados como um só.
      // ---------------------------------------------------------------
      const BATCH_GAP_MS = 30 * 60 * 1000;
      const MSG_TAIL_MS = 12 * 60 * 60 * 1000;

      const flowsRes = await supabase.from("flows").select("id, name").eq("user_id", user.id);
      const flowNames = new Map((flowsRes.data || []).map((f) => [f.id, f.name] as const));
      const flowIds = Array.from(flowNames.keys());

      let execs: any[] = [];
      if (flowIds.length > 0) {
        let execQuery = supabase
          .from("flow_executions")
          .select("flow_id, lead_id, status, started_at")
          .in("flow_id", flowIds)
          .order("started_at", { ascending: true })
          .limit(30000);
        if (startDate) execQuery = execQuery.gte("started_at", startDate.toISOString());
        if (endDate) execQuery = execQuery.lte("started_at", endDate.toISOString());
        execs = (await execQuery).data || [];
      }

      // Mensagens outbound reais no período (status vindo do webhook da Meta)
      const msgsByLead = new Map<string, any[]>();
      if (execs.length > 0) {
        const fromIso = new Date(
          (startDate ? startDate.getTime() : new Date(execs[0].started_at).getTime()) - 60 * 60 * 1000
        ).toISOString();
        const toIso = new Date((endDate ? endDate.getTime() : Date.now()) + MSG_TAIL_MS).toISOString();
        const { data: msgs } = await supabase
          .from("chat_messages")
          .select("lead_id, status, created_at, delivered_at, read_at, error_code")
          .eq("direction", "outbound")
          .gte("created_at", fromIso)
          .lte("created_at", toIso)
          .order("created_at", { ascending: true })
          .limit(30000);
        for (const m of msgs || []) {
          if (!m.lead_id) continue;
          const list = msgsByLead.get(m.lead_id) || [];
          list.push(m);
          msgsByLead.set(m.lead_id, list);
        }
      }

      interface Batch {
        flowId: string;
        startMs: number;
        endMs: number;
        leads: Set<string>;
        total: number;
      }
      const batches: Batch[] = [];
      const execByFlow = new Map<string, any[]>();
      for (const e of execs) {
        const list = execByFlow.get(e.flow_id) || [];
        list.push(e);
        execByFlow.set(e.flow_id, list);
      }
      for (const [flowId, list] of execByFlow) {
        let current: Batch | null = null;
        let lastStart = 0;
        for (const e of list) {
          const startMs = new Date(e.started_at).getTime();
          if (!current || startMs - lastStart > BATCH_GAP_MS) {
            current = { flowId, startMs, endMs: startMs, leads: new Set<string>(), total: 0 };
            batches.push(current);
          }
          lastStart = startMs;
          current.endMs = startMs;
          current.total++;
          if (e.lead_id) current.leads.add(e.lead_id);
        }
      }

      // Completa last_inbound_at dos leads dos fluxos (para contar respostas)
      const flowLeadIds = Array.from(
        new Set(batches.flatMap((b) => Array.from(b.leads)).filter((id) => !inboundByLead.has(id)))
      );
      if (flowLeadIds.length > 0) {
        const flowChunks: string[][] = [];
        for (let i = 0; i < flowLeadIds.length; i += 1000) flowChunks.push(flowLeadIds.slice(i, i + 1000));
        const res = await Promise.all(
          flowChunks.map((chunk) => supabase.from("leads").select("id, last_inbound_at").in("id", chunk))
        );
        for (const r of res) for (const l of r.data || []) inboundByLead.set(l.id, l.last_inbound_at);
      }

      // Cada mensagem é atribuída a um único lote (evita contagem dupla)
      const consumed = new Set<any>();
      const flowRows: CampaignListRow[] = batches
        .sort((a, b) => a.startMs - b.startMs)
        .map((b) => {
          let sent = 0;
          let delivered = 0;
          let read = 0;
          let errors = 0;
          let billable = 0;
          let freeInWindow = 0;
          let replies = 0;

          for (const leadId of b.leads) {
            const list = msgsByLead.get(leadId) || [];
            let firstOfBatch = true;
            for (const m of list) {
              if (consumed.has(m)) continue;
              const t = new Date(m.created_at).getTime();
              if (t < b.startMs - 2 * 60 * 1000 || t > b.endMs + MSG_TAIL_MS) continue;
              consumed.add(m);
              const st = (m.status || "").toLowerCase();
              const failed = st === "failed" || st === "error" || !!m.error_code;
              if (failed) {
                errors++;
                continue;
              }
              if (["pending", "queued", "cancelled", "skipped"].includes(st)) continue;
              sent++;
              const isRead = !!m.read_at || st === "read";
              const isDelivered = !!m.delivered_at || isRead || st === "delivered";
              if (isDelivered) delivered++;
              if (isRead) read++;
              // Primeira mensagem do lote abre a janela de 24h (cobrada);
              // as seguintes caem dentro da janela e são gratuitas.
              if (firstOfBatch) {
                billable++;
                firstOfBatch = false;
              } else {
                freeInWindow++;
              }
            }
            const inbound = inboundByLead.get(leadId);
            if (inbound && new Date(inbound).getTime() >= b.startMs) replies++;
          }

          const cat: "utility" | "marketing" | "authentication" = "marketing";
          const costUsd = billable * PRICING[cat];
          return {
            id: `flow:${b.flowId}:${b.startMs}`,
            name: flowNames.get(b.flowId) || "Fluxo",
            customName: null,
            templateName: flowNames.get(b.flowId) || null,
            date: new Date(b.startMs).toISOString(),
            status: null,
            total: b.total,
            sent,
            delivered,
            read,
            errors,
            replies,
            replyRate: sent > 0 ? (replies / sent) * 100 : 0,
            deliveryRate: sent > 0 ? (delivered / sent) * 100 : 0,
            readRate: sent > 0 ? (read / sent) * 100 : 0,
            billable,
            freeInWindow,
            costUsd,
            costBrl: costUsd * USD_TO_BRL,
            category: cat,
            links: [],
            totalClicks: 0,
            clickRate: 0,
          };
        })
        .filter((r) => r.sent > 0 || r.errors > 0 || r.total > 0);

      const allRows = [...rows, ...flowRows].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );

      const totals = allRows.reduce(
        (acc, r) => {
          acc.sent += r.sent;
          acc.delivered += r.delivered;
          acc.read += r.read;
          acc.errors += r.errors;
          acc.replies += r.replies;
          acc.billable += r.billable;
          acc.freeInWindow += r.freeInWindow;
          acc.costUsd += r.costUsd;
          acc.costBrl += r.costBrl;
          return acc;
        },
        { sent: 0, delivered: 0, read: 0, errors: 0, replies: 0, billable: 0, freeInWindow: 0, costUsd: 0, costBrl: 0 }

      );

      return { rows: allRows, totals };
    },
  });

  return { ...query, isLoading: query.isLoading && !!user };

}

interface Props {
  rows: CampaignListRow[];
  isLoading?: boolean;
  title?: string;
}

// Status de message_logs que valem reenvio: falhas transitórias.
// Excluídos de propósito: invalid_number (número não existe), blocked_by_meta
// (Meta bloqueou o destinatário/conta) e skipped (regra de política, ex.
// janela 24h) — reenviar esses só desperdiça envio ou piora a reputação.
const RESENDABLE_STATUSES = ["error", "rate_limited", "failed"];

export function CampaignListMetrics({ rows, isLoading, title = "Métricas por lista" }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [saving, setSaving] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const visible = rows.filter((r) => r.sent > 0 || r.total > 0);

  const resendFailed = async (jobId: string) => {
    setResendingId(jobId);
    try {
      const { data: original } = await supabase
        .from("broadcast_jobs")
        .select("*")
        .eq("id", jobId)
        .maybeSingle();
      if (!original) throw new Error("Disparo original não encontrado");

      const { data: failedLogs } = await supabase
        .from("message_logs")
        .select("lead_id")
        .eq("job_id", jobId)
        .in("status", RESENDABLE_STATUSES);

      const leadIds = Array.from(new Set((failedLogs || []).map((l: any) => l.lead_id).filter(Boolean)));
      if (leadIds.length === 0) {
        toast.info("Nenhum erro reenviável encontrado (números inválidos e bloqueios não são reenviados)");
        return;
      }

      const { data: job, error } = await supabase
        .from("broadcast_jobs")
        .insert({
          user_id: (original as any).user_id,
          account_id: (original as any).account_id,
          template_id: (original as any).template_id,
          campaign_name: `${(original as any).campaign_name || (original as any).template_name || "Disparo"} (reenvio)`,
          template_name: (original as any).template_name,
          template_language: (original as any).template_language,
          template_params: (original as any).template_params,
          lead_ids: leadIds,
          total_leads: leadIds.length,
          status: "pending",
          multi_number: (original as any).multi_number,
          account_ids: (original as any).account_ids,
          delay_min_seconds: (original as any).delay_min_seconds,
          delay_max_seconds: (original as any).delay_max_seconds,
          messages_per_second: (original as any).messages_per_second,
        } as any)
        .select()
        .single();

      if (error || !job) throw new Error(error?.message || "Erro ao criar reenvio");

      await supabase.functions.invoke("broadcast-processor", { body: { job_id: (job as any).id } });

      toast.success(`Reenvio iniciado para ${leadIds.length} contato(s)`);
      queryClient.invalidateQueries({ queryKey: ["campaign-list-metrics"] });
      queryClient.invalidateQueries({ queryKey: ["broadcast-metrics"] });
      queryClient.invalidateQueries({ queryKey: ["live-sending-progress"] });
    } catch (e: any) {
      toast.error(e?.message || "Erro ao reenviar");
    } finally {
      setResendingId(null);
    }
  };

  const saveName = async (id: string) => {
    setSaving(true);
    const value = draftName.trim();
    const { error } = await supabase
      .from("broadcast_jobs")
      .update({ campaign_name: value || null } as any)
      .eq("id", id);
    setSaving(false);
    if (error) {
      toast.error("Não foi possível renomear a lista");
      return;
    }
    toast.success(value ? "Nome da lista atualizado" : "Nome personalizado removido");
    setEditingId(null);
    queryClient.invalidateQueries({ queryKey: ["campaign-list-metrics"] });
  };

  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{title}</p>
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Carregando...</p>
      ) : visible.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhuma lista no período selecionado.</p>
      ) : (
        <div className="space-y-1.5">
          {visible.map((c) => {
            const isOpen = expandedId === c.id;
            return (
              <div key={c.id} className="rounded-lg border border-border/50 bg-card/40 overflow-hidden">
                {editingId === c.id ? (
                  <div className="flex items-center gap-2 px-3 py-2">
                    <Input
                      autoFocus
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveName(c.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      placeholder={c.templateName || "Nome da lista"}
                      className="h-8 text-sm"
                    />
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => saveName(c.id)}
                      className="p-1.5 rounded-md hover:bg-card text-emerald-500"
                      aria-label="Salvar nome"
                    >
                      <Check size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="p-1.5 rounded-md hover:bg-card text-muted-foreground"
                      aria-label="Cancelar"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                <div className="w-full flex items-center gap-2 px-3 py-2 hover:bg-card/60 transition-colors">
                  <button
                    type="button"
                    onClick={() => setExpandedId(isOpen ? null : c.id)}
                    className="flex items-center gap-2 min-w-0 flex-1 text-left"
                  >
                    {isOpen ? (
                      <ChevronDown size={14} className="text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight size={14} className="text-muted-foreground shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{c.name}</p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {format(new Date(c.date), "dd/MM/yyyy HH:mm", { locale: ptBR })} · {c.category}
                        {c.status ? ` · ${c.status}` : ""}
                        {c.customName && c.templateName ? ` · template: ${c.templateName}` : ""}
                      </p>
                      {/* Contador de evolução do disparo */}
                      {(() => {
                        const processed = Math.min(c.sent + c.errors, c.total || c.sent + c.errors);
                        const total = c.total || processed;
                        const pct = total > 0 ? Math.min(100, (processed / total) * 100) : 0;
                        const running = ["running", "processing", "queued", "pending", "scheduled"].includes(
                          (c.status || "").toLowerCase()
                        );
                        return (
                          <div className="mt-1.5 flex items-center gap-2">
                            <div className="h-1.5 flex-1 min-w-[60px] rounded-full bg-muted overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-500 ${
                                  running ? "bg-primary animate-pulse" : "bg-emerald-500"
                                }`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">
                              {processed.toLocaleString("pt-BR")}/{total.toLocaleString("pt-BR")} ({pct.toFixed(0)}%)
                            </span>
                          </div>
                        );
                      })()}
                    </div>
                  </button>
                  <div className="hidden sm:flex items-center gap-3 shrink-0 text-right">
                    <div>
                      <p className="text-sm font-semibold tabular-nums">{c.sent.toLocaleString("pt-BR")}</p>
                      <p className="text-[10px] text-muted-foreground">enviadas</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold tabular-nums">
                        {Math.max(0, (c.total || 0) - c.sent - c.errors).toLocaleString("pt-BR")}
                      </p>
                      <p className="text-[10px] text-muted-foreground">restantes</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold tabular-nums text-sky-500">{c.readRate.toFixed(1)}%</p>
                      <p className="text-[10px] text-muted-foreground">abertura</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold tabular-nums text-emerald-500">
                        {c.replies.toLocaleString("pt-BR")}
                      </p>
                      <p className="text-[10px] text-muted-foreground">respostas</p>
                    </div>

                    <div>
                      <p className="text-sm font-semibold tabular-nums text-destructive">
                        {c.errors.toLocaleString("pt-BR")}
                      </p>
                      <p className="text-[10px] text-muted-foreground">erros</p>
                    </div>
                  </div>
                  <div className="sm:hidden text-right shrink-0">
                    <p className="text-sm font-semibold tabular-nums">{c.sent.toLocaleString("pt-BR")}</p>
                    <p className="text-[10px] text-muted-foreground">enviadas</p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(c.id);
                      setDraftName(c.customName || "");
                    }}
                    className="p-1.5 rounded-md hover:bg-card text-muted-foreground shrink-0"
                    aria-label="Renomear lista"
                    title="Dar um nome personalizado a esta lista"
                  >
                    <Pencil size={13} />
                  </button>
                </div>
                )}
                {isOpen && (
                  <div className="border-t border-border/50 px-3 py-3 space-y-3 bg-background/40">
                    <div className="grid grid-cols-2 sm:grid-cols-7 gap-2">
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase">Entregues</p>
                        <p className="text-sm font-semibold tabular-nums">{c.delivered.toLocaleString("pt-BR")}</p>
                        <p className="text-[10px] text-emerald-500">{c.deliveryRate.toFixed(1)}%</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase">Lidos</p>
                        <p className="text-sm font-semibold tabular-nums">{c.read.toLocaleString("pt-BR")}</p>
                        <p className="text-[10px] text-sky-500">{c.readRate.toFixed(1)}%</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase">Responderam</p>
                        <p className="text-sm font-semibold tabular-nums">{c.replies.toLocaleString("pt-BR")}</p>
                        <p className="text-[10px] text-emerald-500">{c.replyRate.toFixed(1)}%</p>
                      </div>

                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase">Cliques</p>
                        <p className="text-sm font-semibold tabular-nums">{c.totalClicks.toLocaleString("pt-BR")}</p>
                        <p className="text-[10px] text-primary">{c.clickRate.toFixed(1)}% CTR</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase">Erros</p>
                        <p className="text-sm font-semibold tabular-nums text-destructive">
                          {c.errors.toLocaleString("pt-BR")}
                        </p>
                        <p className="text-[10px] text-destructive">
                          {(c.sent + c.errors > 0 ? (c.errors / (c.sent + c.errors)) * 100 : 0).toFixed(1)}%
                        </p>
                        {c.errors > 0 &&
                          !["running", "processing", "queued", "pending", "scheduled"].includes(
                            (c.status || "").toLowerCase()
                          ) && (
                            <button
                              type="button"
                              disabled={resendingId === c.id}
                              onClick={() => resendFailed(c.id)}
                              className="mt-1 flex items-center gap-1 text-[10px] font-medium text-primary hover:underline disabled:opacity-50"
                              title="Reenviar apenas os contatos que falharam (exclui números inválidos e bloqueios)"
                            >
                              {resendingId === c.id ? (
                                <Loader2 size={11} className="animate-spin" />
                              ) : (
                                <RotateCcw size={11} />
                              )}
                              Reenviar erros
                            </button>
                          )}
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase">Cobradas</p>
                        <p className="text-sm font-semibold tabular-nums">{c.billable.toLocaleString("pt-BR")}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {c.freeInWindow.toLocaleString("pt-BR")} grátis (24h)
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase">Custo</p>
                        <p className="text-sm font-semibold tabular-nums text-revenue">
                          R$ {c.costBrl.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                        <p className="text-[10px] text-muted-foreground">US$ {c.costUsd.toFixed(2)}</p>
                      </div>
                    </div>
                    {c.links.length > 0 ? (
                      <div>
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1">
                          <MousePointerClick size={11} /> Cliques por botão
                        </p>
                        <div className="space-y-1">
                          {[...c.links]
                            .sort((a: any, b: any) => (b.click_count || 0) - (a.click_count || 0))
                            .map((l: any) => (
                              <div
                                key={l.short_code}
                                className="flex items-center justify-between gap-2 text-xs bg-card/40 rounded px-2 py-1.5"
                              >
                                <span className="truncate text-muted-foreground" title={l.original_url}>
                                  {l.original_url}
                                </span>
                                <span className="tabular-nums font-semibold shrink-0">
                                  {(l.click_count || 0).toLocaleString("pt-BR")}
                                </span>
                              </div>
                            ))}
                        </div>
                      </div>
                    ) : (
                      <p className="text-[10px] text-muted-foreground italic">Sem links rastreados neste disparo.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
