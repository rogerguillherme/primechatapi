import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PremiumCard } from "@/components/premium/PremiumCard";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  

  const { startDate, endDate } = useMemo(() => {
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

  const { data } = useQuery({
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

      // O PostgREST limita cada resposta a 1.000 linhas, então paginamos por
      // faixas até trazer todos os registros do período (senão o total de
      // enviadas fica travado em ~1.000).
      const PAGE = 1000;
      const MAX_PAGES = 60; // teto de segurança: 60k mensagens por período
      const fetchAllPages = async <T,>(
        build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
      ): Promise<T[]> => {
        const all: T[] = [];
        for (let page = 0; page < MAX_PAGES; page++) {
          const from = page * PAGE;
          const { data, error } = await build(from, from + PAGE - 1);
          if (error) break;
          const rows = data ?? [];
          all.push(...rows);
          if (rows.length < PAGE) break;
        }
        return all;
      };

      const [clicksRes, logs, outboundRows] = await Promise.all([
        jobIds.length > 0
          ? supabase
              .from("click_tracking_links")
              .select("campaign_id, original_url, short_code, click_count")
              .in("campaign_id", jobIds)
          : Promise.resolve({ data: [] as any[] }),
        fetchAllPages<any>((from, to) =>
          supabase
            .from("message_logs")
            .select("wa_message_id, status, created_at, delivered_at, read_at, failed_at")
            .eq("user_id", user.id)
            .gte("created_at", startIso)
            .lte("created_at", endIso)
            .order("created_at", { ascending: false })
            .range(from, to),
        ),
        fetchAllPages<any>((from, to) =>
          supabase
            .from("chat_messages")
            .select("status, created_at, delivered_at, read_at, zapi_message_id")
            .eq("direction", "outbound")
            .gte("created_at", startIso)
            .lte("created_at", endIso)
            .order("created_at", { ascending: false })
            .range(from, to),
        ),
      ]);


      const clicks = clicksRes.data || [];
      const clicksByJob = new Map<string, any[]>();
      for (const c of clicks) {
        const list = clicksByJob.get(c.campaign_id) || [];
        list.push(c);
        clicksByJob.set(c.campaign_id, list);
      }


      const broadcastWaIds = new Set(logs.map((l: any) => l.wa_message_id).filter(Boolean));

      // Mensagens reais do período: logs de campanha (status real da Meta) +
      // todas as mensagens outbound que não pertencem a esses logs — é aí que
      // ficam os envios disparados por fluxo, que antes não eram contados.
      const templateMsgs = [
        ...logs,
        ...outboundRows.filter(
          (m: any) => !m.zapi_message_id || !broadcastWaIds.has(m.zapi_message_id)
        ),
      ];

      return { jobs, tplCat, clicksByJob, templateMsgs };
    },
    enabled: !!user,
    staleTime: 20_000,
    placeholderData: (prev) => prev,
    refetchInterval: 30_000,
  });

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



  const stats = [
    { label: "Enviadas", value: summary.sent.toLocaleString("pt-BR"), icon: Send, color: "text-primary" },
    { label: "Recebidos", value: summary.delivered.toLocaleString("pt-BR"), hint: `${summary.deliveryRate.toFixed(1)}% entrega`, icon: CheckCheck, color: "text-emerald-500" },
    { label: "Abertura", value: `${summary.readRate.toFixed(1)}%`, hint: `${summary.read.toLocaleString("pt-BR")} lidas`, icon: Eye, color: "text-sky-500" },
    { label: "Falhas", value: summary.errors.toLocaleString("pt-BR"), hint: `${(summary.sent > 0 ? (summary.errors / summary.sent) * 100 : 0).toFixed(1)}%`, icon: AlertTriangle, color: "text-destructive" },
    { label: "Gasto do envio", value: `R$ ${billing.totalBrl.toFixed(2)}`, hint: `${billing.billable.toLocaleString("pt-BR")} cobradas · ${billing.freeInWindow.toLocaleString("pt-BR")} grátis (24h)`, icon: DollarSign, color: "text-amber-500" },
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


      {/* Resumo do período */}
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

      {/* Per-list metrics — progresso "em andamento" já aparece em
          LiveSendingProgress no topo do dashboard; aqui não repetimos. */}
      <CampaignListMetrics rows={listData?.rows || []} isLoading={listLoading} title="Métricas por lista" />

    </PremiumCard>
  );
}

