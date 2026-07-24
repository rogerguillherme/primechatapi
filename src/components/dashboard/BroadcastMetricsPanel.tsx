import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PremiumCard } from "@/components/premium/PremiumCard";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { Send, CheckCheck, Eye, AlertTriangle, DollarSign } from "lucide-react";
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

  const { data, isLoading } = useQuery({
    queryKey: ["broadcast-metrics", user?.id, period],
    queryFn: async () => {
      if (!user) return null;
      const days = PERIOD_DAYS[period];
      const startIso = startOfDay(subDays(new Date(), days - 1)).toISOString();

      const [jobsRes, tplRes] = await Promise.all([
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
      ]);
      const jobs = jobsRes.data || [];
      const tpls = tplRes.data || [];
      const tplCat = new Map(tpls.map((t) => [t.id, inferCategory(t.category)]));
      return { jobs, tplCat, days };
    },
    enabled: !!user,
    refetchInterval: 60_000,
  });

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

  const topCampaigns = useMemo(() => {
    const jobs = data?.jobs || [];
    return [...jobs]
      .filter((j) => (j.sent_count || 0) > 0)
      .sort((a, b) => (b.sent_count || 0) - (a.sent_count || 0))
      .slice(0, 5)
      .map((j) => ({
        id: j.id,
        name: j.template_name || "Disparo",
        sent: j.sent_count || 0,
        read: j.read_count || 0,
        readRate: (j.sent_count || 0) > 0 ? ((j.read_count || 0) / (j.sent_count || 1)) * 100 : 0,
        date: j.created_at,
      }));
  }, [data]);

  const stats = [
    { label: "Enviadas", value: summary.sent, icon: Send, color: "text-primary" },
    { label: "Entregues", value: summary.delivered, hint: `${summary.deliveryRate.toFixed(1)}%`, icon: CheckCheck, color: "text-emerald-500" },
    { label: "Lidas", value: summary.read, hint: `${summary.readRate.toFixed(1)}%`, icon: Eye, color: "text-sky-500" },
    { label: "Erros", value: summary.errors, icon: AlertTriangle, color: "text-destructive" },
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

      {/* Stats grid */}
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

      {/* Cost breakdown */}
      <div className="rounded-xl border border-border/60 bg-gradient-to-br from-revenue/5 to-transparent p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <DollarSign size={16} className="text-revenue" />
            <p className="text-sm font-semibold">Gasto estimado no período</p>
          </div>
          <div className="text-right">
            <p className="text-xl font-display font-bold tabular-nums">
              R$ {summary.totalBrl.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className="text-[10px] text-muted-foreground">
              ≈ US$ {summary.totalUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-lg bg-background/60 border border-border/50 p-2">
            <p className="text-[10px] text-muted-foreground uppercase">Marketing</p>
            <p className="font-semibold tabular-nums">R$ {(summary.costMkt * USD_TO_BRL).toFixed(2)}</p>
          </div>
          <div className="rounded-lg bg-background/60 border border-border/50 p-2">
            <p className="text-[10px] text-muted-foreground uppercase">Utility</p>
            <p className="font-semibold tabular-nums">R$ {(summary.costUtl * USD_TO_BRL).toFixed(2)}</p>
          </div>
          <div className="rounded-lg bg-background/60 border border-border/50 p-2">
            <p className="text-[10px] text-muted-foreground uppercase">Auth</p>
            <p className="font-semibold tabular-nums">R$ {(summary.costAuth * USD_TO_BRL).toFixed(2)}</p>
          </div>
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

      {/* Top campaigns */}
      {topCampaigns.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Top campanhas
          </p>
          <div className="space-y-1.5">
            {topCampaigns.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-card/40 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{c.name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {format(new Date(c.date), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold tabular-nums">{c.sent.toLocaleString("pt-BR")}</p>
                  <p className="text-[10px] text-muted-foreground">{c.readRate.toFixed(0)}% lidas</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </PremiumCard>
  );
}
