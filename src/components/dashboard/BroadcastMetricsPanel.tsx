import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PremiumCard } from "@/components/premium/PremiumCard";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { Send, CheckCheck, Eye, AlertTriangle, DollarSign, MousePointerClick, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, subDays, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";

// WhatsApp Cloud API pricing (USD) — Brazil
const PRICING = {
  utility: 0.008,
  marketing: 0.0625,
  authentication: 0.0315,
};
const USD_TO_BRL = 5.2;

type PeriodKey = "7d" | "30d" | "90d";
const PERIOD_DAYS: Record<PeriodKey, number> = { "7d": 7, "30d": 30, "90d": 90 };

function inferCategory(cat: string | null | undefined): "utility" | "marketing" | "authentication" {
  const c = (cat || "").toLowerCase();
  if (c.includes("util")) return "utility";
  if (c.includes("auth")) return "authentication";
  return "marketing";
}

export function BroadcastMetricsPanel() {
  const { user } = useAuth();
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["broadcast-metrics", user?.id, period],
    queryFn: async () => {
      if (!user) return null;
      const days = PERIOD_DAYS[period];
      const startIso = startOfDay(subDays(new Date(), days - 1)).toISOString();

      const [jobsRes, tplRes, flowMsgsRes] = await Promise.all([
        supabase
          .from("broadcast_jobs")
          .select("id, template_id, template_name, sent_count, delivered_count, read_count, error_count, created_at, status")
          .eq("user_id", user.id)
          .gte("created_at", startIso)
          .order("created_at", { ascending: false }),
        supabase
          .from("chat_templates")
          .select("id, category")
          .eq("user_id", user.id),
        // Flow / conversational outbound (non-template): everything in chat_messages
        // that's outbound and NOT sent as an opening template.
        supabase
          .from("chat_messages")
          .select("id, status, created_at, delivered_at, read_at, account_id, lead_id")
          .eq("direction", "outbound")
          .is("zapi_message_id", null) // heuristic: opening templates carry wa msg id via logs; flow uses this too — refined below
          .gte("created_at", startIso),
      ]);
      const jobs = jobsRes.data || [];
      const tpls = tplRes.data || [];
      const tplCat = new Map(tpls.map((t) => [t.id, inferCategory(t.category)]));

      // Fetch click tracking for these campaigns
      const jobIds = jobs.map((j) => j.id);
      let clicks: any[] = [];
      if (jobIds.length > 0) {
        const { data: cl } = await supabase
          .from("click_tracking_links")
          .select("campaign_id, original_url, short_code, click_count")
          .in("campaign_id", jobIds);
        clicks = cl || [];
      }
      const clicksByJob = new Map<string, any[]>();
      for (const c of clicks) {
        const list = clicksByJob.get(c.campaign_id) || [];
        list.push(c);
        clicksByJob.set(c.campaign_id, list);
      }

      // Flow messages: outbound chat_messages that are NOT part of a broadcast.
      // We approximate by pulling all outbound and subtracting message_logs (broadcast sends).
      const { data: logs } = await supabase
        .from("message_logs")
        .select("wa_message_id, phone, created_at")
        .eq("user_id", user.id)
        .gte("created_at", startIso);
      const broadcastWaIds = new Set((logs || []).map((l) => l.wa_message_id).filter(Boolean));

      const { data: allOutbound } = await supabase
        .from("chat_messages")
        .select("id, status, created_at, zapi_message_id, account_id, lead_id")
        .eq("direction", "outbound")
        .gte("created_at", startIso)
        .limit(10000);

      const flowMsgs = (allOutbound || []).filter((m) => !m.zapi_message_id || !broadcastWaIds.has(m.zapi_message_id));

      return { jobs, tplCat, days, clicksByJob, flowMsgs };
    },
    enabled: !!user,
    refetchInterval: 60_000,
  });

  const flowSummary = useMemo(() => {
    const msgs = data?.flowMsgs || [];
    let sent = 0, delivered = 0, read = 0, errors = 0;
    for (const m of msgs) {
      sent++;
      if (m.status === "delivered" || m.status === "read") delivered++;
      if (m.status === "read") read++;
      if (m.status === "failed" || m.status === "error") errors++;
    }
    return {
      sent, delivered, read, errors,
      deliveryRate: sent > 0 ? (delivered / sent) * 100 : 0,
      readRate: sent > 0 ? (read / sent) * 100 : 0,
    };
  }, [data]);


  const summary = useMemo(() => {
    const jobs = data?.jobs || [];
    const tplCat = data?.tplCat || new Map();
    let sent = 0, delivered = 0, read = 0, errors = 0;
    let costMkt = 0, costUtl = 0, costAuth = 0;

    for (const j of jobs) {
      const s = j.sent_count || 0;
      sent += s;
      delivered += j.delivered_count || 0;
      read += j.read_count || 0;
      errors += j.error_count || 0;
      const cat = (j.template_id && tplCat.get(j.template_id)) || "marketing";
      if (cat === "utility") costUtl += s * PRICING.utility;
      else if (cat === "authentication") costAuth += s * PRICING.authentication;
      else costMkt += s * PRICING.marketing;
    }

    const totalUsd = costMkt + costUtl + costAuth;
    return {
      sent, delivered, read, errors,
      costMkt, costUtl, costAuth, totalUsd,
      totalBrl: totalUsd * USD_TO_BRL,
      readRate: sent > 0 ? (read / sent) * 100 : 0,
      deliveryRate: sent > 0 ? (delivered / sent) * 100 : 0,
    };
  }, [data]);

  const chartData = useMemo(() => {
    const days = data?.days ?? PERIOD_DAYS[period];
    const jobs = data?.jobs || [];
    const buckets = new Map<string, number>();
    for (let i = days - 1; i >= 0; i--) {
      const key = format(subDays(new Date(), i), "yyyy-MM-dd");
      buckets.set(key, 0);
    }
    for (const j of jobs) {
      const key = format(new Date(j.created_at), "yyyy-MM-dd");
      if (buckets.has(key)) buckets.set(key, (buckets.get(key) || 0) + (j.sent_count || 0));
    }
    return Array.from(buckets.entries()).map(([date, sent]) => ({
      date,
      label: format(new Date(date), days <= 7 ? "EEE dd" : "dd/MM", { locale: ptBR }),
      sent,
    }));
  }, [data, period]);

  const campaignRows = useMemo(() => {
    const jobs = data?.jobs || [];
    const tplCat = data?.tplCat || new Map();
    const clicksByJob = data?.clicksByJob || new Map<string, any[]>();
    return [...jobs]
      .filter((j) => (j.sent_count || 0) > 0)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .map((j) => {
        const sent = j.sent_count || 0;
        const delivered = j.delivered_count || 0;
        const read = j.read_count || 0;
        const errors = j.error_count || 0;
        const cat = (j.template_id && tplCat.get(j.template_id)) || "marketing";
        const rate = cat === "utility" ? PRICING.utility : cat === "authentication" ? PRICING.authentication : PRICING.marketing;
        const costBrl = sent * rate * USD_TO_BRL;
        const links = clicksByJob.get(j.id) || [];
        const totalClicks = links.reduce((s, l) => s + (l.click_count || 0), 0);
        return {
          id: j.id,
          name: j.template_name || "Disparo",
          date: j.created_at,
          sent,
          delivered,
          read,
          errors,
          deliveryRate: sent > 0 ? (delivered / sent) * 100 : 0,
          readRate: sent > 0 ? (read / sent) * 100 : 0,
          costBrl,
          category: cat,
          links,
          totalClicks,
          clickRate: sent > 0 ? (totalClicks / sent) * 100 : 0,
        };
      });
  }, [data]);

  const stats = [
    { label: "Enviadas", value: summary.sent, icon: Send, color: "text-primary" },
    { label: "Entregues", value: summary.delivered, hint: `${summary.deliveryRate.toFixed(1)}%`, icon: CheckCheck, color: "text-emerald-500" },
    { label: "Lidas", value: summary.read, hint: `${summary.readRate.toFixed(1)}%`, icon: Eye, color: "text-sky-500" },
    { label: "Erros", value: summary.errors, icon: AlertTriangle, color: "text-destructive" },
  ];

  const flowStats = [
    { label: "Enviadas", value: flowSummary.sent, icon: Send, color: "text-primary" },
    { label: "Entregues", value: flowSummary.delivered, hint: `${flowSummary.deliveryRate.toFixed(1)}%`, icon: CheckCheck, color: "text-emerald-500" },
    { label: "Lidas", value: flowSummary.read, hint: `${flowSummary.readRate.toFixed(1)}%`, icon: Eye, color: "text-sky-500" },
    { label: "Erros", value: flowSummary.errors, icon: AlertTriangle, color: "text-destructive" },
  ];

  return (
    <PremiumCard className="p-5 sm:p-6 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-display font-bold">Disparos & Custos</h2>
          <p className="text-xs text-muted-foreground">Performance e gasto estimado com WhatsApp Cloud API</p>
        </div>
        <Select value={period} onValueChange={(v) => setPeriod(v as PeriodKey)}>
          <SelectTrigger className="h-9 w-[140px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">Últimos 7 dias</SelectItem>
            <SelectItem value="30d">Últimos 30 dias</SelectItem>
            <SelectItem value="90d">Últimos 90 dias</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Aberturas 24h */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Aberturas de janela 24h (templates)
          </p>
          <span className="text-[10px] text-muted-foreground">Mensagens iniciais via template</span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {stats.map((s) => (
            <div key={s.label} className="rounded-xl border border-border/60 bg-card/40 p-3">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{s.label}</p>
                <s.icon size={14} className={cn(s.color)} />
              </div>
              <p className="text-2xl font-display font-bold tabular-nums leading-none">
                {s.value.toLocaleString("pt-BR")}
              </p>
              {s.hint && <p className="text-[10px] text-muted-foreground mt-1">{s.hint}</p>}
            </div>
          ))}
        </div>
      </div>

      {/* Mensagens de fluxo */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Mensagens de fluxo
          </p>
          <span className="text-[10px] text-muted-foreground">Dentro da janela 24h · sem custo por mensagem</span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {flowStats.map((s) => (
            <div key={s.label} className="rounded-xl border border-border/60 bg-card/40 p-3">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{s.label}</p>
                <s.icon size={14} className={cn(s.color)} />
              </div>
              <p className="text-2xl font-display font-bold tabular-nums leading-none">
                {s.value.toLocaleString("pt-BR")}
              </p>
              {s.hint && <p className="text-[10px] text-muted-foreground mt-1">{s.hint}</p>}
            </div>
          ))}
        </div>
      </div>


      {/* Daily chart */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Volume diário
        </p>
        <div className="h-[180px]">
          {isLoading ? (
            <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
              Carregando...
            </div>
          ) : summary.sent === 0 ? (
            <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
              Sem disparos no período selecionado
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: "hsl(var(--foreground))" }}
                  formatter={(v: number) => [v.toLocaleString("pt-BR"), "Enviadas"]}
                />
                <Bar dataKey="sent" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Per-campaign metrics */}
      {campaignRows.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Métricas por disparo
          </p>
          <div className="space-y-1.5">
            {campaignRows.map((c) => {
              const isOpen = expandedId === c.id;
              return (
                <div key={c.id} className="rounded-lg border border-border/50 bg-card/40 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setExpandedId(isOpen ? null : c.id)}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-card/60 transition-colors text-left"
                  >
                    {isOpen ? <ChevronDown size={14} className="text-muted-foreground shrink-0" /> : <ChevronRight size={14} className="text-muted-foreground shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{c.name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {format(new Date(c.date), "dd/MM/yyyy HH:mm", { locale: ptBR })} · {c.category}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold tabular-nums">{c.sent.toLocaleString("pt-BR")}</p>
                      <p className="text-[10px] text-muted-foreground">enviadas</p>
                    </div>
                  </button>
                  {isOpen && (
                    <div className="border-t border-border/50 px-3 py-3 space-y-3 bg-background/40">
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase">Entregues</p>
                          <p className="text-sm font-semibold tabular-nums">{c.delivered.toLocaleString("pt-BR")}</p>
                          <p className="text-[10px] text-emerald-500">{c.deliveryRate.toFixed(1)}%</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase">Abertura</p>
                          <p className="text-sm font-semibold tabular-nums">{c.read.toLocaleString("pt-BR")}</p>
                          <p className="text-[10px] text-sky-500">{c.readRate.toFixed(1)}%</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase">Cliques</p>
                          <p className="text-sm font-semibold tabular-nums">{c.totalClicks.toLocaleString("pt-BR")}</p>
                          <p className="text-[10px] text-primary">{c.clickRate.toFixed(1)}% CTR</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase">Erros</p>
                          <p className="text-sm font-semibold tabular-nums text-destructive">{c.errors.toLocaleString("pt-BR")}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase">Custo</p>
                          <p className="text-sm font-semibold tabular-nums text-revenue">
                            R$ {c.costBrl.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </p>
                        </div>
                      </div>
                      {c.links.length > 0 && (
                        <div>
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1">
                            <MousePointerClick size={11} /> Cliques por botão
                          </p>
                          <div className="space-y-1">
                            {c.links
                              .sort((a: any, b: any) => (b.click_count || 0) - (a.click_count || 0))
                              .map((l: any) => (
                                <div key={l.short_code} className="flex items-center justify-between gap-2 text-xs bg-card/40 rounded px-2 py-1.5">
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
                      )}
                      {c.links.length === 0 && (
                        <p className="text-[10px] text-muted-foreground italic">
                          Sem links rastreados neste disparo.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </PremiumCard>
  );
}
