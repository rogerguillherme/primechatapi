import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Send, CheckCheck, Eye, MousePointerClick, MessageCircle, ShoppingCart,
  TrendingUp, BarChart3, ChevronDown, ChevronRight, DollarSign, Target,
} from "lucide-react";
import { useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

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

export function CampaignAnalytics() {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: campaigns, isLoading } = useQuery({
    queryKey: ["campaign-analytics"],
    queryFn: async () => {
      // Get all broadcast jobs
      const { data: jobs } = await supabase
        .from("broadcast_jobs")
        .select("id, created_at, template_name, total_leads, sent_count, delivered_count, read_count, error_count, status")
        .order("created_at", { ascending: false })
        .limit(50);

      if (!jobs || jobs.length === 0) return [] as CampaignMetrics[];

      // Get all campaign events for these jobs
      const jobIds = jobs.map(j => j.id);
      const { data: events } = await supabase
        .from("campaign_events")
        .select("campaign_id, event_type, metadata")
        .in("campaign_id", jobIds);

      // Aggregate events per campaign
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

      return jobs.map(job => ({
        ...job,
        events: eventMap.get(job.id) || { sent: 0, delivered: 0, read: 0, click: 0, reply: 0, purchase: 0, revenue: 0 },
      }));
    },
    refetchInterval: 15000,
  });

  // Global stats
  const globalStats = campaigns?.reduce(
    (acc, c) => ({
      total: acc.total + c.total_leads,
      sent: acc.sent + c.sent_count,
      delivered: acc.delivered + c.delivered_count,
      read: acc.read + c.read_count,
      clicks: acc.clicks + c.events.click,
      replies: acc.replies + c.events.reply,
      purchases: acc.purchases + c.events.purchase,
      revenue: acc.revenue + c.events.revenue,
    }),
    { total: 0, sent: 0, delivered: 0, read: 0, clicks: 0, replies: 0, purchases: 0, revenue: 0 }
  ) || { total: 0, sent: 0, delivered: 0, read: 0, clicks: 0, replies: 0, purchases: 0, revenue: 0 };

  const summaryCards = [
    { label: "Enviados", value: globalStats.sent, icon: Send, color: "text-amber-500", pctVal: pct(globalStats.sent, globalStats.total) },
    { label: "Entregues", value: globalStats.delivered, icon: CheckCheck, color: "text-emerald-500", pctVal: pct(globalStats.delivered, globalStats.sent) },
    { label: "Lidos", value: globalStats.read, icon: Eye, color: "text-blue-500", pctVal: pct(globalStats.read, globalStats.delivered) },
    { label: "Cliques", value: globalStats.clicks, icon: MousePointerClick, color: "text-violet-500", pctVal: pct(globalStats.clicks, globalStats.read) },
    { label: "Respostas", value: globalStats.replies, icon: MessageCircle, color: "text-cyan-500", pctVal: pct(globalStats.replies, globalStats.sent) },
    { label: "Vendas", value: globalStats.purchases, icon: ShoppingCart, color: "text-rose-500", pctVal: pct(globalStats.purchases, globalStats.sent) },
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
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <TrendingUp size={16} /> Analytics de Campanhas
        </h3>
        {globalStats.revenue > 0 && (
          <Badge variant="secondary" className="gap-1">
            <DollarSign size={12} />
            R$ {globalStats.revenue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
          </Badge>
        )}
      </div>

      {/* Global Summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {summaryCards.map((card) => (
          <Card key={card.label}>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center justify-between mb-1">
                <card.icon size={16} className={card.color} />
                <span className="text-[10px] font-mono text-muted-foreground">{card.pctVal}</span>
              </div>
              <p className="text-xl font-bold">{isLoading ? "—" : card.value.toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground">{card.label}</p>
            </CardContent>
          </Card>
        ))}
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
            <p className="text-sm text-muted-foreground text-center py-8">Nenhuma campanha registrada.</p>
          ) : (
            <ScrollArea className="max-h-[600px]">
              <div className="divide-y divide-border">
                {campaigns.map((campaign) => {
                  const isExpanded = expandedId === campaign.id;
                  return (
                    <CampaignRow
                      key={campaign.id}
                      campaign={campaign}
                      isExpanded={isExpanded}
                      onToggle={() => setExpandedId(isExpanded ? null : campaign.id)}
                      statusColors={statusColors}
                      statusLabels={statusLabels}
                    />
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CampaignRow({
  campaign,
  isExpanded,
  onToggle,
  statusColors,
  statusLabels,
}: {
  campaign: CampaignMetrics;
  isExpanded: boolean;
  onToggle: () => void;
  statusColors: Record<string, string>;
  statusLabels: Record<string, string>;
}) {
  const progressPct = campaign.total_leads > 0
    ? Math.round((campaign.sent_count / campaign.total_leads) * 100)
    : 0;

  const deliveryRate = campaign.sent_count > 0
    ? ((campaign.delivered_count / campaign.sent_count) * 100).toFixed(1)
    : "0";

  const readRate = campaign.delivered_count > 0
    ? ((campaign.read_count / campaign.delivered_count) * 100).toFixed(1)
    : "0";

  const ctr = campaign.read_count > 0
    ? ((campaign.events.click / campaign.read_count) * 100).toFixed(1)
    : "0";

  const conversionRate = campaign.sent_count > 0
    ? ((campaign.events.purchase / campaign.sent_count) * 100).toFixed(2)
    : "0";

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
            <p className="text-sm font-medium truncate">
              {campaign.template_name || "Campanha sem template"}
            </p>
            <Badge className={cn("text-[10px]", statusColors[campaign.status] || "bg-muted")}>
              {statusLabels[campaign.status] || campaign.status}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {format(new Date(campaign.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
            {" · "}{campaign.total_leads} leads
          </p>
        </div>
        <div className="hidden md:flex items-center gap-4 text-xs text-muted-foreground">
          <span className="text-amber-500 font-mono">{campaign.sent_count}</span>
          <span className="text-emerald-500 font-mono">{campaign.delivered_count}</span>
          <span className="text-blue-500 font-mono">{campaign.read_count}</span>
          {campaign.events.click > 0 && (
            <span className="text-violet-500 font-mono">{campaign.events.click} cliques</span>
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 pl-11 bg-muted/20 space-y-4">
          {/* Progress bar */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Progresso do envio</span>
              <span>{progressPct}%</span>
            </div>
            <Progress value={progressPct} className="h-2" />
          </div>

          {/* Metrics grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard label="Enviados" value={campaign.sent_count} total={campaign.total_leads} color="text-amber-500" />
            <MetricCard label="Entregues" value={campaign.delivered_count} total={campaign.sent_count} color="text-emerald-500" />
            <MetricCard label="Lidos" value={campaign.read_count} total={campaign.delivered_count} color="text-blue-500" />
            <MetricCard label="Erros" value={campaign.error_count} total={campaign.total_leads} color="text-destructive" />
          </div>

          {/* Events grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className="text-center py-2 rounded-md bg-background border border-border">
              <MousePointerClick size={14} className="text-violet-500 mx-auto mb-1" />
              <p className="text-lg font-bold text-violet-500">{campaign.events.click}</p>
              <p className="text-[10px] text-muted-foreground">Cliques</p>
            </div>
            <div className="text-center py-2 rounded-md bg-background border border-border">
              <MessageCircle size={14} className="text-cyan-500 mx-auto mb-1" />
              <p className="text-lg font-bold text-cyan-500">{campaign.events.reply}</p>
              <p className="text-[10px] text-muted-foreground">Respostas</p>
            </div>
            <div className="text-center py-2 rounded-md bg-background border border-border">
              <ShoppingCart size={14} className="text-rose-500 mx-auto mb-1" />
              <p className="text-lg font-bold text-rose-500">{campaign.events.purchase}</p>
              <p className="text-[10px] text-muted-foreground">Vendas</p>
            </div>
          </div>

          {/* Calculated rates */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <RateCard label="Taxa de Entrega" value={`${deliveryRate}%`} />
            <RateCard label="Taxa de Leitura" value={`${readRate}%`} />
            <RateCard label="CTR" value={`${ctr}%`} />
            <RateCard label="Conversão" value={`${conversionRate}%`} />
          </div>

          {/* Revenue */}
          {campaign.events.revenue > 0 && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <DollarSign size={16} className="text-emerald-500" />
              <div>
                <p className="text-sm font-bold text-emerald-500">
                  R$ {campaign.events.revenue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </p>
                <p className="text-[10px] text-muted-foreground">Faturamento total da campanha</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  return (
    <div className="text-center py-2 rounded-md bg-background border border-border">
      <p className={cn("text-lg font-bold", color)}>{value.toLocaleString()}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="text-[10px] font-mono text-muted-foreground">{pct(value, total)}</p>
    </div>
  );
}

function RateCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center py-2 rounded-md bg-background border border-border">
      <p className="text-sm font-bold">{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}
