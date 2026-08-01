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
          .select("wa_message_id")
          .eq("user_id", user.id)
          .gte("created_at", startIso)
          .lte("created_at", endIso)
          .not("wa_message_id", "is", null)
          .limit(20000),
        supabase
          .from("chat_messages")
          .select("id, status, created_at, zapi_message_id, account_id, lead_id")
          .eq("direction", "outbound")
          .gte("created_at", startIso)
          .lte("created_at", endIso)
          .order("created_at", { ascending: false })
          .limit(2000),
      ]);

      const clicks = clicksRes.data || [];
      const clicksByJob = new Map<string, any[]>();
      for (const c of clicks) {
        const list = clicksByJob.get(c.campaign_id) || [];
        list.push(c);
        clicksByJob.set(c.campaign_id, list);
      }

      const broadcastWaIds = new Set((logsRes.data || []).map((l: any) => l.wa_message_id).filter(Boolean));

      // Flow messages: outbound chat_messages that are NOT part of a broadcast.
      const flowMsgs = (outboundRes.data || []).filter(
        (m: any) => !m.zapi_message_id || !broadcastWaIds.has(m.zapi_message_id)
      );

      return { jobs, tplCat, days, clicksByJob, flowMsgs };

    },
    enabled: !!user,
    refetchInterval: 60_000,
  });

  const isLoading = queryLoading && !!user;



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

  // Per-list metrics + billing that discounts free 24h-window messages
  const { data: listData, isLoading: listLoading } = useCampaignListMetrics(startDate, endDate);
  const billing = {
    billable: listData?.totals.billable || 0,
    freeInWindow: listData?.totals.freeInWindow || 0,
    totalUsd: listData?.totals.costUsd || 0,
    totalBrl: listData?.totals.costBrl || 0,
  };


  const chartData = useMemo(() => {
    const jobs = data?.jobs || [];
    const buckets = new Map<string, number>();
    for (let i = days - 1; i >= 0; i--) {
      const key = format(subDays(endDate, i), "yyyy-MM-dd");
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

      {/* Per-list metrics */}
      <CampaignListMetrics rows={listData?.rows || []} isLoading={listLoading} title="Métricas por lista" />
    </PremiumCard>
  );
}

