import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DollarSign, TrendingUp, MessageSquare, BarChart3 } from "lucide-react";
import { format, subDays, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";

// WhatsApp Cloud API pricing for Brazil (USD)
const PRICING = {
  utility: 0.0080,
  marketing: 0.0625,
  authentication: 0.0315,
  service: 0.0300,
};

// BRL conversion rate (approximate)
const USD_TO_BRL = 5.20;

type PeriodFilter = "7d" | "30d" | "this_month" | "last_month" | "all";

function getPeriodDates(period: PeriodFilter): { start: Date | null; end: Date } {
  const now = new Date();
  switch (period) {
    case "7d":
      return { start: subDays(now, 7), end: now };
    case "30d":
      return { start: subDays(now, 30), end: now };
    case "this_month":
      return { start: startOfMonth(now), end: now };
    case "last_month": {
      const lastMonth = subMonths(now, 1);
      return { start: startOfMonth(lastMonth), end: endOfMonth(lastMonth) };
    }
    case "all":
      return { start: null, end: now };
  }
}

export function FinancialTab() {
  const { user } = useAuth();
  const [period, setPeriod] = useState<PeriodFilter>("this_month");
  const [currency, setCurrency] = useState<"BRL" | "USD">("BRL");

  const { start, end } = useMemo(() => getPeriodDates(period), [period]);

  // Fetch broadcast jobs with template info to determine category
  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ["financial-jobs", user?.id, period],
    queryFn: async () => {
      let query = supabase
        .from("broadcast_jobs")
        .select("id, sent_count, delivered_count, error_count, template_id, template_name, created_at, status")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });

      if (start) {
        query = query.gte("created_at", start.toISOString());
      }
      query = query.lte("created_at", end.toISOString());

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  // Fetch templates to get categories
  const { data: templates = [] } = useQuery({
    queryKey: ["financial-templates", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chat_templates")
        .select("id, name, category, template_name");
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  // Calculate costs
  const stats = useMemo(() => {
    const templateMap = new Map(templates.map((t) => [t.id, t]));

    let utilityMessages = 0;
    let marketingMessages = 0;
    let otherMessages = 0;
    let totalSent = 0;
    let totalDelivered = 0;
    let totalErrors = 0;

    for (const job of jobs) {
      const template = job.template_id ? templateMap.get(job.template_id) : null;
      const category = (template?.category || "").toLowerCase();
      const sent = job.sent_count || 0;

      totalSent += sent;
      totalDelivered += job.delivered_count || 0;
      totalErrors += job.error_count || 0;

      if (category.includes("utility") || category.includes("utilidade")) {
        utilityMessages += sent;
      } else if (category.includes("marketing")) {
        marketingMessages += sent;
      } else {
        // Default to marketing pricing for unknown categories
        marketingMessages += sent;
      }
    }

    const utilityCostUSD = utilityMessages * PRICING.utility;
    const marketingCostUSD = marketingMessages * PRICING.marketing;
    const otherCostUSD = otherMessages * PRICING.utility;
    const totalCostUSD = utilityCostUSD + marketingCostUSD + otherCostUSD;

    const rate = currency === "BRL" ? USD_TO_BRL : 1;
    const symbol = currency === "BRL" ? "R$" : "$";

    return {
      utilityMessages,
      marketingMessages,
      otherMessages,
      totalSent,
      totalDelivered,
      totalErrors,
      utilityCost: utilityCostUSD * rate,
      marketingCost: marketingCostUSD * rate,
      totalCost: totalCostUSD * rate,
      symbol,
      jobs,
    };
  }, [jobs, templates, currency]);

  const formatCurrency = (value: number) => {
    return `${stats.symbol} ${value.toFixed(2)}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <DollarSign size={20} />
            Financeiro
          </h2>
          <p className="text-sm text-muted-foreground">
            Custos estimados de envio via WhatsApp Cloud API
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={currency} onValueChange={(v) => setCurrency(v as "BRL" | "USD")}>
            <SelectTrigger className="w-20 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="BRL">R$</SelectItem>
              <SelectItem value="USD">USD</SelectItem>
            </SelectContent>
          </Select>
          <Select value={period} onValueChange={(v) => setPeriod(v as PeriodFilter)}>
            <SelectTrigger className="w-40 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Últimos 7 dias</SelectItem>
              <SelectItem value="30d">Últimos 30 dias</SelectItem>
              <SelectItem value="this_month">Este mês</SelectItem>
              <SelectItem value="last_month">Mês passado</SelectItem>
              <SelectItem value="all">Todo período</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <MessageSquare size={16} className="text-blue-500" />
              </div>
              Utility
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatCurrency(stats.utilityCost)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {stats.utilityMessages.toLocaleString()} mensagens × {stats.symbol} {(PRICING.utility * (currency === "BRL" ? USD_TO_BRL : 1)).toFixed(4)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
                <TrendingUp size={16} className="text-purple-500" />
              </div>
              Marketing
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatCurrency(stats.marketingCost)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {stats.marketingMessages.toLocaleString()} mensagens × {stats.symbol} {(PRICING.marketing * (currency === "BRL" ? USD_TO_BRL : 1)).toFixed(4)}
            </p>
          </CardContent>
        </Card>

        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <DollarSign size={16} className="text-primary" />
              </div>
              Total
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-primary">{formatCurrency(stats.totalCost)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {stats.totalSent.toLocaleString()} mensagens enviadas
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Pricing Reference */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3 size={16} />
            Tabela de Preços (Brasil)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(PRICING).map(([type, price]) => (
              <div key={type} className="rounded-lg border border-border p-3 text-center">
                <p className="text-xs text-muted-foreground capitalize">{type}</p>
                <p className="text-sm font-semibold mt-1">
                  {stats.symbol} {(price * (currency === "BRL" ? USD_TO_BRL : 1)).toFixed(4)}
                </p>
                <p className="text-[10px] text-muted-foreground">por mensagem</p>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground mt-3">
            * Valores estimados com base na tabela oficial da Meta para o Brasil. 
            {currency === "BRL" && ` Câmbio aproximado: 1 USD = ${USD_TO_BRL.toFixed(2)} BRL.`}
          </p>
        </CardContent>
      </Card>

      {/* Per-campaign breakdown */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Detalhamento por Campanha</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="text-sm text-muted-foreground text-center py-6">Carregando...</p>
          ) : stats.jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Nenhum disparo no período selecionado.</p>
          ) : (
            <div className="divide-y divide-border">
              {stats.jobs.map((job) => {
                const template = templates.find((t) => t.id === job.template_id);
                const category = (template?.category || "marketing").toLowerCase();
                const isUtility = category.includes("utility") || category.includes("utilidade");
                const pricePerMsg = isUtility ? PRICING.utility : PRICING.marketing;
                const rate = currency === "BRL" ? USD_TO_BRL : 1;
                const cost = (job.sent_count || 0) * pricePerMsg * rate;

                return (
                  <div key={job.id} className="flex items-center justify-between px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">
                          {job.template_name || template?.name || "Campanha"}
                        </p>
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          {isUtility ? "Utility" : "Marketing"}
                        </Badge>
                        <Badge
                          variant={job.status === "completed" ? "default" : "secondary"}
                          className="text-[10px] shrink-0"
                        >
                          {job.status}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {format(new Date(job.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })} · {(job.sent_count || 0).toLocaleString()} enviadas
                      </p>
                    </div>
                    <p className="text-sm font-semibold ml-4 shrink-0">
                      {formatCurrency(cost)}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
