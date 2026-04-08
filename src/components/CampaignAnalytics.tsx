import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Send, CheckCheck, Eye, MousePointerClick, MessageCircle, ShoppingCart,
  TrendingUp, ChevronDown, ChevronRight, DollarSign, Target, Zap, Activity,
} from "lucide-react";
import { useState, useMemo } from "react";
import { format, subDays, startOfDay, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";

interface CampaignMetrics {
  id: string;
  created_at: string;
  template_name: string | null;
  total_leads: number;
  sent_count: number;
  delivered_count: number;
  read_count: number;
  error_count: number;
  status: string;
  events: {
    sent: number;
    delivered: number;
    read: number;
    click: number;
    reply: number;
    purchase: number;
    revenue: number;
  };
}

function pct(n: number, t: number): string {
  return t > 0 ? `${((n / t) * 100).toFixed(1)}%` : "0%";
}

const CHART_COLORS = {
  sent: "hsl(38, 92%, 50%)",
  delivered: "hsl(160, 84%, 39%)",
  read: "hsl(217, 91%, 60%)",
  click: "hsl(263, 70%, 50%)",
  reply: "hsl(187, 85%, 43%)",
  purchase: "hsl(350, 89%, 60%)",
  error: "hsl(0, 84%, 60%)",
};

const PIE_COLORS = [
  "hsl(160, 84%, 39%)",
  "hsl(217, 91%, 60%)",
  "hsl(263, 70%, 50%)",
  "hsl(350, 89%, 60%)",
  "hsl(38, 92%, 50%)",
];

export function CampaignAnalytics() {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: campaigns, isLoading } = useQuery({
    queryKey: ["campaign-analytics"],
    queryFn: async () => {
      const { data: jobs } = await supabase
        .from("broadcast_jobs")
        .select("id, created_at, template_name, total_leads, sent_count, delivered_count, read_count, error_count, status")
        .order("created_at", { ascending: false })
        .limit(50);

      if (!jobs || jobs.length === 0) return [] as CampaignMetrics[];

      const jobIds = jobs.map(j => j.id);
      const { data: events } = await supabase
        .from("campaign_events")
        .select("campaign_id, event_type, metadata")
        .in("campaign_id", jobIds);

      const eventMap = new Map<string, CampaignMetrics["events"]>();
      for (const job of jobs) {
        eventMap.set(job.id, { sent: 0, delivered: 0, read: 0, click: 0, reply: 0, purchase: 0, revenue: 0 });
      }

      for (const ev of events || []) {
        const entry = eventMap.get(ev.campaign_id);
        if (!entry) continue;
        const type = ev.event_type as keyof typeof entry;
        if (type in entry && type !== "revenue") {
          (entry as any)[type]++;
        }
        if (type === "purchase" && ev.metadata) {
          const meta = typeof ev.metadata === "string" ? JSON.parse(ev.metadata) : ev.metadata;
          entry.revenue += (meta as any)?.valor || 0;
        }
      }

      return jobs.map(job => {
        const eventsForJob = eventMap.get(job.id) || { sent: 0, delivered: 0, read: 0, click: 0, reply: 0, purchase: 0, revenue: 0 };

        return {
          ...job,
          delivered_count: Math.max(job.delivered_count || 0, eventsForJob.delivered),
          read_count: Math.max(job.read_count || 0, eventsForJob.read),
          events: eventsForJob,
        };
      });
    },
    refetchInterval: 15000,
  });

  // Global stats
  const globalStats = useMemo(() => {
    return campaigns?.reduce(
      (acc, c) => ({
        total: acc.total + c.total_leads,
        sent: acc.sent + c.sent_count,
        delivered: acc.delivered + c.delivered_count,
        read: acc.read + c.read_count,
        errors: acc.errors + c.error_count,
        clicks: acc.clicks + c.events.click,
        replies: acc.replies + c.events.reply,
        purchases: acc.purchases + c.events.purchase,
        revenue: acc.revenue + c.events.revenue,
      }),
      { total: 0, sent: 0, delivered: 0, read: 0, errors: 0, clicks: 0, replies: 0, purchases: 0, revenue: 0 }
    ) || { total: 0, sent: 0, delivered: 0, read: 0, errors: 0, clicks: 0, replies: 0, purchases: 0, revenue: 0 };
  }, [campaigns]);

  // Chart data: last 7 days
  const areaChartData = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = subDays(new Date(), 6 - i);
      return { date: startOfDay(date), label: format(date, "dd/MM", { locale: ptBR }), sent: 0, delivered: 0, read: 0 };
    });

    for (const c of campaigns || []) {
      const cDate = startOfDay(new Date(c.created_at));
      const dayEntry = days.find(d => isSameDay(d.date, cDate));
      if (dayEntry) {
        dayEntry.sent += c.sent_count;
        dayEntry.delivered += c.delivered_count;
        dayEntry.read += c.read_count;
      }
    }

    return days;
  }, [campaigns]);

  // Funnel data
  const funnelData = useMemo(() => [
    { name: "Enviados", value: globalStats.sent, fill: CHART_COLORS.sent },
    { name: "Entregues", value: globalStats.delivered, fill: CHART_COLORS.delivered },
    { name: "Lidos", value: globalStats.read, fill: CHART_COLORS.read },
    { name: "Cliques", value: globalStats.clicks, fill: CHART_COLORS.click },
    { name: "Vendas", value: globalStats.purchases, fill: CHART_COLORS.purchase },
  ], [globalStats]);

  // Pie data for engagement breakdown
  const pieData = useMemo(() => {
    const data = [
      { name: "Entregues", value: Math.max(globalStats.delivered - globalStats.read, 0) },
      { name: "Lidos", value: Math.max(globalStats.read - globalStats.clicks - globalStats.replies, 0) },
      { name: "Cliques", value: globalStats.clicks },
      { name: "Respostas", value: globalStats.replies },
      { name: "Vendas", value: globalStats.purchases },
    ].filter(d => d.value > 0);
    return data.length > 0 ? data : [{ name: "Sem dados", value: 1 }];
  }, [globalStats]);

  const summaryCards = [
    { label: "Total Leads", value: globalStats.total, icon: Target, gradient: "from-amber-500/20 to-amber-600/5", iconColor: "text-amber-500" },
    { label: "Enviados", value: globalStats.sent, icon: Send, gradient: "from-amber-500/20 to-amber-600/5", iconColor: "text-amber-500", pctVal: pct(globalStats.sent, globalStats.total) },
    { label: "Entregues", value: globalStats.delivered, icon: CheckCheck, gradient: "from-emerald-500/20 to-emerald-600/5", iconColor: "text-emerald-500", pctVal: pct(globalStats.delivered, globalStats.sent) },
    { label: "Lidos", value: globalStats.read, icon: Eye, gradient: "from-blue-500/20 to-blue-600/5", iconColor: "text-blue-500", pctVal: pct(globalStats.read, globalStats.delivered) },
    { label: "Cliques", value: globalStats.clicks, icon: MousePointerClick, gradient: "from-violet-500/20 to-violet-600/5", iconColor: "text-violet-500", pctVal: pct(globalStats.clicks, globalStats.read) },
    { label: "Vendas", value: globalStats.purchases, icon: ShoppingCart, gradient: "from-rose-500/20 to-rose-600/5", iconColor: "text-rose-500", pctVal: pct(globalStats.purchases, globalStats.sent) },
  ];

  const statusColors: Record<string, string> = {
    completed: "bg-emerald-500/10 text-emerald-500",
    processing: "bg-amber-500/10 text-amber-500",
    pending: "bg-muted text-muted-foreground",
    paused_by_system: "bg-destructive/10 text-destructive",
    error: "bg-destructive/10 text-destructive",
    cancelled: "bg-muted text-muted-foreground",
  };

  const statusLabels: Record<string, string> = {
    completed: "Concluída",
    processing: "Em andamento",
    pending: "Pendente",
    paused_by_system: "Pausada",
    error: "Erro",
    cancelled: "Cancelada",
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5">
            <Activity size={20} className="text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-bold">Analytics de Campanhas</h2>
            <p className="text-xs text-muted-foreground">Performance e métricas em tempo real</p>
          </div>
        </div>
        {globalStats.revenue > 0 && (
          <Badge variant="secondary" className="gap-1.5 text-sm py-1 px-3">
            <DollarSign size={14} />
            R$ {globalStats.revenue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
          </Badge>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {summaryCards.map((card) => (
          <Card key={card.label} className="relative overflow-hidden border-border/50">
            <div className={cn("absolute inset-0 bg-gradient-to-br opacity-50", card.gradient)} />
            <CardContent className="relative pt-4 pb-3 px-4">
              <div className="flex items-center justify-between mb-2">
                <card.icon size={18} className={card.iconColor} />
                {card.pctVal && (
                  <span className="text-[10px] font-mono text-muted-foreground bg-background/80 px-1.5 py-0.5 rounded">{card.pctVal}</span>
                )}
              </div>
              <p className="text-2xl font-bold">{isLoading ? "—" : card.value.toLocaleString()}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{card.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Area chart - last 7 days */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp size={16} className="text-primary" />
              Envios nos últimos 7 dias
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={areaChartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradSent" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_COLORS.sent} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={CHART_COLORS.sent} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradDelivered" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_COLORS.delivered} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={CHART_COLORS.delivered} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradRead" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_COLORS.read} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={CHART_COLORS.read} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: "12px",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                  }}
                />
                <Area type="monotone" dataKey="sent" name="Enviados" stroke={CHART_COLORS.sent} fill="url(#gradSent)" strokeWidth={2} />
                <Area type="monotone" dataKey="delivered" name="Entregues" stroke={CHART_COLORS.delivered} fill="url(#gradDelivered)" strokeWidth={2} />
                <Area type="monotone" dataKey="read" name="Lidos" stroke={CHART_COLORS.read} fill="url(#gradRead)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Pie chart - engagement */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap size={16} className="text-primary" />
              Engajamento
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4 flex flex-col items-center">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={3}
                  dataKey="value"
                  strokeWidth={0}
                >
                  {pieData.map((_, index) => (
                    <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap gap-3 justify-center mt-2">
              {pieData.map((d, i) => (
                <div key={d.name} className="flex items-center gap-1.5 text-[11px]">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                  <span className="text-muted-foreground">{d.name}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Funnel bar chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp size={16} className="text-primary" />
            Funil de Conversão
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={funnelData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }} barCategoryGap="20%">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
              />
              <Bar dataKey="value" name="Total" radius={[6, 6, 0, 0]}>
                {funnelData.map((entry, index) => (
                  <Cell key={index} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* KPI Rates */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <RateCard label="Taxa de Entrega" value={pct(globalStats.delivered, globalStats.sent)} color="text-emerald-500" />
        <RateCard label="Taxa de Leitura" value={pct(globalStats.read, globalStats.delivered)} color="text-blue-500" />
        <RateCard label="CTR (Cliques)" value={pct(globalStats.clicks, globalStats.read)} color="text-violet-500" />
        <RateCard label="Conversão" value={pct(globalStats.purchases, globalStats.sent)} color="text-rose-500" />
      </div>

      {/* Campaigns List */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Target size={16} /> Campanhas ({campaigns?.length || 0})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="text-sm text-muted-foreground text-center py-8">Carregando...</p>
          ) : !campaigns?.length ? (
            <div className="text-center py-12 space-y-2">
              <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-3">
                <Send size={20} className="text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">Nenhuma campanha registrada.</p>
              <p className="text-xs text-muted-foreground/60">Crie um disparo para ver as métricas aqui.</p>
            </div>
          ) : (
            <ScrollArea className="max-h-[500px]">
              <div className="divide-y divide-border">
                {campaigns.map((campaign) => (
                  <CampaignRow
                    key={campaign.id}
                    campaign={campaign}
                    isExpanded={expandedId === campaign.id}
                    onToggle={() => setExpandedId(expandedId === campaign.id ? null : campaign.id)}
                    statusColors={statusColors}
                    statusLabels={statusLabels}
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

function CampaignRow({
  campaign, isExpanded, onToggle, statusColors, statusLabels,
}: {
  campaign: CampaignMetrics;
  isExpanded: boolean;
  onToggle: () => void;
  statusColors: Record<string, string>;
  statusLabels: Record<string, string>;
}) {
  const progressPct = campaign.total_leads > 0 ? Math.round((campaign.sent_count / campaign.total_leads) * 100) : 0;

  return (
    <div>
      <button
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent/30 transition-colors text-left"
        onClick={onToggle}
      >
        <span className="text-muted-foreground shrink-0">
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium truncate">{campaign.template_name || "Campanha"}</p>
            <Badge className={cn("text-[10px]", statusColors[campaign.status] || "bg-muted")}>{statusLabels[campaign.status] || campaign.status}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {format(new Date(campaign.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })} · {campaign.total_leads} leads
          </p>
        </div>
        <div className="hidden md:flex items-center gap-3 text-xs font-mono">
          <span className="text-amber-500">{campaign.sent_count}</span>
          <span className="text-emerald-500">{campaign.delivered_count}</span>
          <span className="text-blue-500">{campaign.read_count}</span>
        </div>
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 pl-11 bg-muted/20 space-y-3">
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Progresso</span>
              <span>{progressPct}%</span>
            </div>
            <Progress value={progressPct} className="h-2" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <MiniMetric label="Enviados" value={campaign.sent_count} color="text-amber-500" />
            <MiniMetric label="Entregues" value={campaign.delivered_count} color="text-emerald-500" />
            <MiniMetric label="Lidos" value={campaign.read_count} color="text-blue-500" />
            <MiniMetric label="Erros" value={campaign.error_count} color="text-destructive" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <MiniMetric label="Cliques" value={campaign.events.click} color="text-violet-500" />
            <MiniMetric label="Respostas" value={campaign.events.reply} color="text-cyan-500" />
            <MiniMetric label="Vendas" value={campaign.events.purchase} color="text-rose-500" />
          </div>
          {campaign.events.revenue > 0 && (
            <div className="flex items-center gap-2 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <DollarSign size={14} className="text-emerald-500" />
              <span className="text-sm font-bold text-emerald-500">
                R$ {campaign.events.revenue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MiniMetric({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="text-center py-2 rounded-md bg-background border border-border">
      <p className={cn("text-base font-bold", color)}>{value.toLocaleString()}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

function RateCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="pt-4 pb-3 px-4 text-center">
        <p className={cn("text-xl font-bold", color)}>{value}</p>
        <p className="text-[11px] text-muted-foreground mt-1">{label}</p>
      </CardContent>
    </Card>
  );
}
