import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PremiumCard } from "@/components/premium/PremiumCard";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { Send, CheckCheck, Eye, AlertTriangle, DollarSign, CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, subDays, startOfDay, endOfDay, differenceInCalendarDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CampaignListMetrics, useCampaignListMetrics } from "./CampaignListMetrics";


// WhatsApp Cloud API pricing (USD) — Brazil
const PRICING = {
  utility: 0.008,
  marketing: 0.0625,
  authentication: 0.0315,
};
const USD_TO_BRL = 5.2;

type PeriodKey = "today" | "7d" | "30d" | "90d" | "custom";
const PERIOD_DAYS: Record<Exclude<PeriodKey, "custom">, number> = { today: 1, "7d": 7, "30d": 30, "90d": 90 };

function inferCategory(cat: string | null | undefined): "utility" | "marketing" | "authentication" {
  const c = (cat || "").toLowerCase();
  if (c.includes("util")) return "utility";
  if (c.includes("auth")) return "authentication";
  return "marketing";
}

export function BroadcastMetricsPanel() {
  const { user } = useAuth();
  const [period, setPeriod] = useState<PeriodKey>("today");
  const [customRange, setCustomRange] = useState<{ from?: Date; to?: Date }>({});
  

  const { startDate, endDate, days } = useMemo(() => {
    if (period === "custom" && customRange.from) {
      const from = startOfDay(customRange.from);
      const to = endOfDay(customRange.to || customRange.from);
      return { startDate: from, endDate: to, days: differenceInCalendarDays(to, from) + 1 };
    }
    const d = PERIOD_DAYS[(period === "custom" ? "today" : period) as Exclude<PeriodKey, "custom">];
    return { startDate: startOfDay(subDays(new Date(), d - 1)), endDate: endOfDay(new Date()), days: d };
  }, [period, customRange]);

  const rangeLabel =
    period === "custom" && customRange.from
      ? `${format(customRange.from, "dd/MM/yy", { locale: ptBR })} – ${format(customRange.to || customRange.from, "dd/MM/yy", { locale: ptBR })}`
      : "Personalizado";

  const { data, isLoading: queryLoading } = useQuery({
    queryKey: ["broadcast-metrics", user?.id, startDate.toISOString(), endDate.toISOString()],
    queryFn: async () => {
      if (!user) return null;
      const startIso = startDate.toISOString();
      const endIso = endDate.toISOString();

      const [jobsRes, tplRes] = await Promise.all([
        supabase
          .from("broadcast_jobs")
          .select("id, template_id, template_name, sent_count, delivered_count, read_count, error_count, created_at, status")
          .eq("user_id", user.id)
          .gte("created_at", startIso)
          .lte("created_at", endIso)
          .order("created_at", { ascending: false })
          .limit(200),
        supabase
          .from("chat_templates")
          .select("id, category")
          .eq("user_id", user.id),
      ]);

      const jobs = jobsRes.data || [];
      const tpls = tplRes.data || [];
      const tplCat = new Map(tpls.map((t) => [t.id, inferCategory(t.category)]));

      // Fetch click tracking + broadcast logs + outbound messages in parallel
      const jobIds = jobs.map((j) => j.id);
      const [clicksRes, logsRes, outboundRes] = await Promise.all([
        jobIds.length > 0
          ? supabase
              .from("click_tracking_links")
              .select("campaign_id, original_url, short_code, click_count")
              .in("campaign_id", jobIds)
          : Promise.resolve({ data: [] as any[] }),
        supabase
          .from("message_logs")
          .select("wa_message_id, status, created_at, delivered_at, read_at, failed_at")
          .eq("user_id", user.id)
          .gte("created_at", startIso)
          .lte("created_at", endIso)
          .limit(8000),
        supabase
          .from("chat_messages")
          .select("status, created_at, delivered_at, read_at, zapi_message_id")
          .eq("direction", "outbound")
          .gte("created_at", startIso)
          .lte("created_at", endIso)
          .order("created_at", { ascending: false })
          .limit(8000),
      ]);


      const clicks = clicksRes.data || [];
      const clicksByJob = new Map<string, any[]>();
      for (const c of clicks) {
        const list = clicksByJob.get(c.campaign_id) || [];
        list.push(c);
        clicksByJob.set(c.campaign_id, list);
      }

      const logs = logsRes.data || [];
      const broadcastWaIds = new Set(logs.map((l: any) => l.wa_message_id).filter(Boolean));

      // Flow messages: outbound chat_messages that are NOT part of a broadcast.
      const flowMsgs = (outboundRes.data || []).filter(
        (m: any) => !m.zapi_message_id || !broadcastWaIds.has(m.zapi_message_id)
      );

      // Template/broadcast messages: from message_logs (real Meta status) plus
      // any outbound chat_message linked to a broadcast.
      const templateMsgs = [
        ...logs,
        ...(outboundRes.data || []).filter(
          (m: any) => m.zapi_message_id && broadcastWaIds.has(m.zapi_message_id) && !logs.length
        ),
      ];

      return { jobs, tplCat, days, clicksByJob, flowMsgs, templateMsgs };



    },
    enabled: !!user,
    staleTime: 20_000,
    placeholderData: (prev) => prev,
    refetchInterval: 30_000,
  });


  const isLoading = queryLoading && !!user;



  /** Counts real delivery/read using timestamps first, status as fallback. */
  const countMsgs = (msgs: any[]) => {
    let sent = 0, delivered = 0, read = 0, errors = 0;
    for (const m of msgs) {
      const st = (m.status || "").toLowerCase();
      const failed = st === "failed" || st === "error" || !!m.failed_at;
      const isRead = !!m.read_at || st === "read";
      const isDelivered = !!m.delivered_at || isRead || st === "delivered";
      if (failed) { errors++; continue; }
      if (st === "cancelled" || st === "skipped" || st === "pending" || st === "queued") continue;
      sent++;
      if (isDelivered) delivered++;
      if (isRead) read++;
    }
    return {
      sent, delivered, read, errors,
      deliveryRate: sent > 0 ? (delivered / sent) * 100 : 0,
      readRate: sent > 0 ? (read / sent) * 100 : 0,
    };
  };

  const flowSummary = useMemo(() => countMsgs(data?.flowMsgs || []), [data]);

  const summary = useMemo(() => {
    const jobs = data?.jobs || [];
    const tplCat = data?.tplCat || new Map();
    const fromMsgs = countMsgs(data?.templateMsgs || []);

    // Fallback: aggregated job counters (used only when there are no per-message logs)
    let jSent = 0, jDelivered = 0, jRead = 0, jErrors = 0;
    let costMkt = 0, costUtl = 0, costAuth = 0;
    for (const j of jobs) {
      const s = j.sent_count || 0;
      jSent += s;
      jDelivered += j.delivered_count || 0;
      jRead += j.read_count || 0;
      jErrors += j.error_count || 0;
      const cat = (j.template_id && tplCat.get(j.template_id)) || "marketing";
      if (cat === "utility") costUtl += s * PRICING.utility;
      else if (cat === "authentication") costAuth += s * PRICING.authentication;
      else costMkt += s * PRICING.marketing;
    }

    const sent = Math.max(fromMsgs.sent, jSent);
    const delivered = Math.max(fromMsgs.delivered, jDelivered);
    const read = Math.max(fromMsgs.read, jRead);
    const errors = Math.max(fromMsgs.errors, jErrors);

    if (jobs.length === 0 && sent > 0) costMkt = sent * PRICING.marketing;
    const totalUsd = costMkt + costUtl + costAuth;
    return {
      sent, delivered, read, errors,
      costMkt, costUtl, costAuth, totalUsd,
      totalBrl: totalUsd * USD_TO_BRL,
      readRate: sent > 0 ? (read / sent) * 100 : 0,
      deliveryRate: sent > 0 ? (delivered / sent) * 100 : 0,
    };
  }, [data]);


  // Per-list metrics + billing that discounts free 24h-window messages
  const { data: listData, isLoading: listLoading } = useCampaignListMetrics(startDate, endDate);
  const listBillable = listData?.totals.billable || 0;
  const billing = {
    // Fallback: quando não há logs por lista, cobra pelas mensagens de template enviadas
    billable: listBillable > 0 ? listBillable : summary.sent,
    freeInWindow: listData?.totals.freeInWindow || 0,
    totalUsd: listBillable > 0 ? listData?.totals.costUsd || 0 : summary.totalUsd,
    totalBrl: listBillable > 0 ? listData?.totals.costBrl || 0 : summary.totalBrl,
  };



  const chartData = useMemo(() => {
    const msgs = [...(data?.templateMsgs || []), ...(data?.flowMsgs || [])];
    const buckets = new Map<string, number>();
    for (let i = days - 1; i >= 0; i--) {
      const key = format(subDays(endDate, i), "yyyy-MM-dd");
      buckets.set(key, 0);
    }
    for (const m of msgs) {
      if (!m.created_at) continue;
      const st = (m.status || "").toLowerCase();
      if (["cancelled", "skipped", "pending", "queued"].includes(st)) continue;
      const key = format(new Date(m.created_at), "yyyy-MM-dd");
      if (buckets.has(key)) buckets.set(key, (buckets.get(key) || 0) + 1);
    }
    return Array.from(buckets.entries()).map(([date, sent]) => ({
      date,
      label: format(new Date(date), days <= 7 ? "EEE dd" : "dd/MM", { locale: ptBR }),
      sent,
    }));
  }, [data, days, endDate]);



  const stats = [
    { label: "Enviadas", value: summary.sent.toLocaleString("pt-BR"), icon: Send, color: "text-primary" },
    { label: "Recebidos", value: summary.delivered.toLocaleString("pt-BR"), hint: `${summary.deliveryRate.toFixed(1)}% entrega`, icon: CheckCheck, color: "text-emerald-500" },
    { label: "Abertura", value: `${summary.readRate.toFixed(1)}%`, hint: `${summary.read.toLocaleString("pt-BR")} lidas`, icon: Eye, color: "text-sky-500" },
    { label: "Falhas", value: summary.errors.toLocaleString("pt-BR"), hint: `${(summary.sent > 0 ? (summary.errors / summary.sent) * 100 : 0).toFixed(1)}%`, icon: AlertTriangle, color: "text-destructive" },
    { label: "Gasto do envio", value: `R$ ${billing.totalBrl.toFixed(2)}`, hint: `${billing.billable.toLocaleString("pt-BR")} cobradas · ${billing.freeInWindow.toLocaleString("pt-BR")} grátis (24h)`, icon: DollarSign, color: "text-amber-500" },
  ];


  const flowStats = [
    { label: "Enviadas", value: flowSummary.sent.toLocaleString("pt-BR"), icon: Send, color: "text-primary" },
    { label: "Recebidos", value: flowSummary.delivered.toLocaleString("pt-BR"), hint: `${flowSummary.deliveryRate.toFixed(1)}% entrega`, icon: CheckCheck, color: "text-emerald-500" },
    { label: "Abertura", value: `${flowSummary.readRate.toFixed(1)}%`, hint: `${flowSummary.read.toLocaleString("pt-BR")} lidas`, icon: Eye, color: "text-sky-500" },
    { label: "Falhas", value: flowSummary.errors.toLocaleString("pt-BR"), icon: AlertTriangle, color: "text-destructive" },
  ];

  return (
    <PremiumCard className="p-5 sm:p-6 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-display font-bold">Disparos & Custos</h2>
          <p className="text-xs text-muted-foreground">Performance e gasto estimado com WhatsApp Cloud API</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={period} onValueChange={(v) => setPeriod(v as PeriodKey)}>
            <SelectTrigger className="h-9 w-[150px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Hoje</SelectItem>
              <SelectItem value="7d">Últimos 7 dias</SelectItem>
              <SelectItem value="30d">Últimos 30 dias</SelectItem>
              <SelectItem value="90d">Últimos 90 dias</SelectItem>
              <SelectItem value="custom">Personalizado</SelectItem>
            </SelectContent>
          </Select>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant={period === "custom" ? "default" : "outline"}
                size="sm"
                className="h-9 gap-1.5 text-xs"
              >
                <CalendarIcon size={14} />
                {rangeLabel}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="range"
                selected={customRange.from ? { from: customRange.from, to: customRange.to } : undefined}
                onSelect={(range: any) => {
                  setCustomRange({ from: range?.from, to: range?.to });
                  if (range?.from) setPeriod("custom");
                }}
                numberOfMonths={2}
                locale={ptBR}
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>


      {/* Aberturas 24h */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Aberturas de janela 24h (templates)
          </p>
          <span className="text-[10px] text-muted-foreground">Mensagens iniciais via template</span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {stats.map((s) => (
            <div key={s.label} className="rounded-xl border border-border/60 bg-card/40 p-3">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{s.label}</p>
                <s.icon size={14} className={cn(s.color)} />
              </div>
              <p className="text-2xl font-display font-bold tabular-nums leading-none">
                {s.value}
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
                {s.value}
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
          ) : chartData.every((d) => d.sent === 0) ? (
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

      {/* Contador global de evolução dos disparos */}
      {(() => {
        const rows = listData?.rows || [];
        const active = rows.filter((r) =>
          ["running", "processing", "queued", "pending", "scheduled"].includes((r.status || "").toLowerCase())
        );
        const totalAll = rows.reduce((s, r) => s + (r.total || 0), 0);
        const processedAll = rows.reduce((s, r) => s + Math.min(r.sent + r.errors, r.total || r.sent + r.errors), 0);
        const pct = totalAll > 0 ? Math.min(100, (processedAll / totalAll) * 100) : 0;
        if (totalAll === 0) return null;
        return (
          <div className="rounded-lg border border-border/50 bg-card/40 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Evolução dos disparos
              </p>
              <p className="text-xs tabular-nums">
                <span className="font-semibold">{processedAll.toLocaleString("pt-BR")}</span>
                <span className="text-muted-foreground"> / {totalAll.toLocaleString("pt-BR")} contatos</span>
                <span className="text-muted-foreground"> · {pct.toFixed(1)}%</span>
              </p>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  active.length > 0 ? "bg-primary animate-pulse" : "bg-emerald-500"
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-[10px] text-muted-foreground">
              {active.length > 0
                ? `${active.length} disparo(s) em andamento · ${Math.max(0, totalAll - processedAll).toLocaleString("pt-BR")} restantes`
                : "Nenhum disparo em andamento no período"}
            </p>
          </div>
        );
      })()}

      {/* Per-list metrics */}
      <CampaignListMetrics rows={listData?.rows || []} isLoading={listLoading} title="Métricas por lista" />

    </PremiumCard>
  );
}

