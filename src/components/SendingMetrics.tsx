import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { WhatsAppLimits } from "./WhatsAppLimits";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Send, CheckCheck, Eye, Inbox, RefreshCw, ChevronDown, ChevronRight, MessageCircle,
  Loader2, Zap, Download,
} from "lucide-react";
import { useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useWhatsAppAccounts } from "@/hooks/use-whatsapp-accounts";

function getAvatarColor(name: string) {
  const colors = ["bg-emerald-600", "bg-violet-600", "bg-amber-600", "bg-rose-600", "bg-cyan-600", "bg-indigo-600"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}
function getInitials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

interface BroadcastGroup {
  key: string;
  label: string;
  total: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  leadIds: string[];
  type?: "broadcast" | "flow";
  flowId?: string;
  date?: string;
}

interface AccountStats {
  id: string;
  name: string;
  total: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
}

interface CampaignEventRow {
  campaign_id: string;
  event_type: string;
}

function buildCampaignEventCountMap(events: CampaignEventRow[] | null | undefined) {
  const map = new Map<string, { delivered: number; read: number }>();

  for (const event of events || []) {
    if (event.event_type !== "delivered" && event.event_type !== "read") continue;
    const current = map.get(event.campaign_id) || { delivered: 0, read: 0 };
    if (event.event_type === "delivered") current.delivered += 1;
    if (event.event_type === "read") current.read += 1;
    map.set(event.campaign_id, current);
  }

  return map;
}

function getEffectiveJobCounts(
  job: { id: string; delivered_count: number | null; read_count: number | null },
  eventMap: Map<string, { delivered: number; read: number }>
) {
  const eventCounts = eventMap.get(job.id);

  return {
    delivered: Math.max(job.delivered_count || 0, eventCounts?.delivered || 0),
    read: Math.max(job.read_count || 0, eventCounts?.read || 0),
  };
}

export function SendingMetrics() {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const { accounts } = useWhatsAppAccounts();

  const handleRefresh = () => {
    setRefreshing(true);
    queryClient.invalidateQueries({ queryKey: ["sending-metrics-summary"] });
    queryClient.invalidateQueries({ queryKey: ["sending-metrics-dispatches"] });
    queryClient.invalidateQueries({ queryKey: ["sending-metrics-by-account"] });
    setTimeout(() => setRefreshing(false), 800);
  };

  const { data: stats, isLoading } = useQuery({
    queryKey: ["sending-metrics-summary"],
    queryFn: async () => {
      // Combine broadcast_jobs + outbound chat_messages
      const { data: jobs } = await supabase
        .from("broadcast_jobs")
        .select("id, total_leads, sent_count, delivered_count, read_count, error_count");

      let bjTotal = 0, bjSent = 0, bjDelivered = 0, bjRead = 0;
      if (jobs && jobs.length > 0) {
        const { data: events } = await supabase
          .from("campaign_events")
          .select("campaign_id, event_type")
          .in("campaign_id", jobs.map((job) => job.id));

        const eventMap = buildCampaignEventCountMap(events as CampaignEventRow[] | null | undefined);

        bjTotal = jobs.reduce((sum, j) => sum + (j.total_leads || 0), 0);
        bjSent = jobs.reduce((sum, j) => sum + (j.sent_count || 0), 0);
        bjDelivered = jobs.reduce((sum, j) => sum + getEffectiveJobCounts(j, eventMap).delivered, 0);
        bjRead = jobs.reduce((sum, j) => sum + getEffectiveJobCounts(j, eventMap).read, 0);
      }

      // Count outbound messages (covers flow sends, manual sends, etc.)
      const { count: outboundCount } = await supabase
        .from("chat_messages")
        .select("id", { count: "exact", head: true })
        .eq("direction", "outbound");

      const { count: deliveredCount } = await supabase
        .from("chat_messages")
        .select("id", { count: "exact", head: true })
        .eq("direction", "outbound")
        .not("delivered_at", "is", null);

      const { count: readCount } = await supabase
        .from("chat_messages")
        .select("id", { count: "exact", head: true })
        .eq("direction", "outbound")
        .not("read_at", "is", null);

      const msgTotal = outboundCount || 0;
      const msgDelivered = deliveredCount || 0;
      const msgRead = readCount || 0;

      return {
        total: Math.max(bjTotal, msgTotal),
        sent: Math.max(bjSent, msgTotal),
        delivered: Math.max(bjDelivered, msgDelivered),
        read: Math.max(bjRead, msgRead),
      };
    },
    refetchInterval: 30000,
  });

  const { data: accountStats } = useQuery({
    queryKey: ["sending-metrics-by-account"],
    queryFn: async () => {
      const accountMap = new Map<string, { total: number; sent: number; delivered: number; read: number; failed: number }>();

      // Broadcast jobs
      const { data: jobs } = await supabase
        .from("broadcast_jobs")
        .select("id, account_id, total_leads, sent_count, delivered_count, read_count, error_count");

      const { data: events } = jobs && jobs.length > 0
        ? await supabase
            .from("campaign_events")
            .select("campaign_id, event_type")
            .in("campaign_id", jobs.map((job) => job.id))
        : { data: [] };

      const eventMap = buildCampaignEventCountMap(events as CampaignEventRow[] | null | undefined);

      if (jobs) {
        for (const job of jobs) {
          const effective = getEffectiveJobCounts(job, eventMap);
          const accId = job.account_id || "unknown";
          const cur = accountMap.get(accId) || { total: 0, sent: 0, delivered: 0, read: 0, failed: 0 };
          cur.total += job.total_leads || 0;
          cur.sent += job.sent_count || 0;
          cur.delivered += effective.delivered;
          cur.read += effective.read;
          cur.failed += job.error_count || 0;
          accountMap.set(accId, cur);
        }
      }

      // Outbound messages per account
      for (const acc of accounts) {
        const { count: outCount } = await supabase
          .from("chat_messages")
          .select("id", { count: "exact", head: true })
          .eq("direction", "outbound")
          .eq("account_id", acc.id);

        const existing = accountMap.get(acc.id) || { total: 0, sent: 0, delivered: 0, read: 0, failed: 0 };
        const msgCount = outCount || 0;
        if (msgCount > existing.total) {
          existing.total = msgCount;
          existing.sent = msgCount;
        }
        if (msgCount > 0) accountMap.set(acc.id, existing);
      }

      const result: AccountStats[] = [];
      for (const acc of accounts) {
        const s = accountMap.get(acc.id);
        if (!s || s.total === 0) continue;
        result.push({ id: acc.id, name: acc.name, ...s });
      }

      const unknown = accountMap.get("unknown");
      if (unknown && unknown.total > 0) {
        result.push({ id: "unknown", name: "Sem conta", ...unknown });
      }

      return result;
    },
    enabled: accounts.length > 0,
    refetchInterval: 30000,
  });

  const { data: dispatches, isLoading: loadingDispatches } = useQuery({
    queryKey: ["sending-metrics-dispatches"],
    queryFn: async () => {
      const groups: BroadcastGroup[] = [];

      // 1. Broadcast jobs
      const { data: jobs } = await supabase
        .from("broadcast_jobs")
        .select("id, created_at, total_leads, sent_count, delivered_count, read_count, error_count, lead_ids, template_name")
        .order("created_at", { ascending: false });

      const { data: events } = jobs && jobs.length > 0
        ? await supabase
            .from("campaign_events")
            .select("campaign_id, event_type")
            .in("campaign_id", jobs.map((job) => job.id))
        : { data: [] };

      const eventMap = buildCampaignEventCountMap(events as CampaignEventRow[] | null | undefined);

      if (jobs) {
        for (const job of jobs) {
          const effective = getEffectiveJobCounts(job, eventMap);
          const dateStr = format(new Date(job.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR });
          groups.push({
            key: job.id,
            label: `Disparo ${dateStr}${job.template_name ? ` — ${job.template_name}` : ""}`,
            total: job.total_leads || job.lead_ids?.length || 0,
            sent: job.sent_count || 0,
            delivered: effective.delivered,
            read: effective.read,
            failed: job.error_count || 0,
            leadIds: job.lead_ids || [],
            type: "broadcast",
          });
        }
      }

      // 2. Flow executions grouped by flow + date
      const { data: flowExecs } = await supabase
        .from("flow_executions")
        .select("id, flow_id, lead_id, status, started_at")
        .order("started_at", { ascending: false })
        .limit(1000);

      if (flowExecs && flowExecs.length > 0) {
        const flowIds = [...new Set(flowExecs.map(fe => fe.flow_id))];
        const { data: flows } = await supabase
          .from("flows")
          .select("id, name")
          .in("id", flowIds);
        const flowNameMap = new Map((flows || []).map(f => [f.id, f.name]));

        // Group by flow_id + date
        const flowGroups = new Map<string, { flowId: string; date: string; leadIds: string[]; completed: number; failed: number; cancelled: number; startedAt: string }>();
        for (const fe of flowExecs) {
          // Use local-date key so the calendar date matches the user's timezone
          const localDate = new Date(fe.started_at);
          const dateKey = `${localDate.getFullYear()}-${String(localDate.getMonth() + 1).padStart(2, "0")}-${String(localDate.getDate()).padStart(2, "0")}`;
          const groupKey = `flow-${fe.flow_id}-${dateKey}`;
          const existing = flowGroups.get(groupKey) || { flowId: fe.flow_id, date: dateKey, leadIds: [], completed: 0, failed: 0, cancelled: 0, startedAt: fe.started_at };
          existing.leadIds.push(fe.lead_id);
          if (fe.status === "failed") existing.failed++;
          else if (fe.status === "cancelled") existing.cancelled++;
          else existing.completed++; // completed / waiting_* / running = message sent
          flowGroups.set(groupKey, existing);
        }

        for (const [key, group] of flowGroups) {
          const flowName = flowNameMap.get(group.flowId) || "Fluxo";
          // Parse as local date to avoid UTC shift (e.g. "2026-05-24" → 23/05 in BRT)
          const [y, m, d] = group.date.split("-").map(Number);
          const dateStr = format(new Date(y, m - 1, d), "dd/MM/yyyy", { locale: ptBR });
          groups.push({
            key,
            label: `⚡ ${flowName} — ${dateStr}`,
            total: group.leadIds.length,
            sent: group.completed,
            delivered: group.completed,
            read: 0,
            failed: group.failed + group.cancelled,
            leadIds: group.leadIds,
            type: "flow",
            flowId: group.flowId,
            date: group.date,
          });
        }
      }

      // Sort: most recent first
      return groups;
    },
    refetchInterval: 30000,
  });

  const pct = (n: number, t: number) => t > 0 ? `${Math.round((n / t) * 100)}%` : "—";

  const metrics = [
    { label: "Total", value: stats?.total || 0, icon: <Send size={18} />, colorClass: "text-primary" },
    { label: "Enviado", value: stats?.sent || 0, icon: <CheckCheck size={18} />, colorClass: "text-amber-500", percent: pct(stats?.sent || 0, stats?.total || 0) },
    { label: "Recebido", value: stats?.delivered || 0, icon: <Inbox size={18} />, colorClass: "text-emerald-500", percent: pct(stats?.delivered || 0, stats?.total || 0) },
    { label: "Lido", value: stats?.read || 0, icon: <Eye size={18} />, colorClass: "text-blue-500", percent: pct(stats?.read || 0, stats?.total || 0) },
  ];

  return (
    <div className="space-y-4">
      <WhatsAppLimits />

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">Métricas gerais</h3>
        <Button variant="outline" size="sm" onClick={handleRefresh} className="gap-1.5">
          <RefreshCw size={14} className={cn(refreshing && "animate-spin")} />
          Atualizar
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {metrics.map((m) => (
          <Card key={m.label}>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center justify-between mb-1">
                <span className={m.colorClass}>{m.icon}</span>
                {m.percent && (
                  <Badge variant="secondary" className="text-[10px] font-mono">{m.percent}</Badge>
                )}
              </div>
              <p className="text-2xl font-bold">{isLoading ? "—" : m.value}</p>
              <p className="text-xs text-muted-foreground">{m.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {accountStats && accountStats.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <MessageCircle size={16} /> Disparos por conta
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {accountStats.map((acc) => (
                <div key={acc.id} className="px-4 py-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">{acc.name}</span>
                    <Badge variant="outline" className="text-[10px] font-mono">{acc.total} total</Badge>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    <div className="text-center py-1.5 rounded-md bg-muted/50">
                      <p className="text-sm font-bold text-amber-500">{acc.sent}</p>
                      <p className="text-[10px] text-muted-foreground">Enviado</p>
                    </div>
                    <div className="text-center py-1.5 rounded-md bg-muted/50">
                      <p className="text-sm font-bold text-emerald-500">{acc.delivered}</p>
                      <p className="text-[10px] text-muted-foreground">Recebido</p>
                    </div>
                    <div className="text-center py-1.5 rounded-md bg-muted/50">
                      <p className="text-sm font-bold text-blue-500">{acc.read}</p>
                      <p className="text-[10px] text-muted-foreground">Lido</p>
                    </div>
                    <div className="text-center py-1.5 rounded-md bg-muted/50">
                      <p className="text-sm font-bold text-destructive">{acc.failed}</p>
                      <p className="text-[10px] text-muted-foreground">Falhou</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Send size={16} /> Disparos realizados
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loadingDispatches ? (
            <p className="text-sm text-muted-foreground text-center py-8">Carregando...</p>
          ) : !dispatches?.length ? (
            <p className="text-sm text-muted-foreground text-center py-8">Nenhum disparo registrado.</p>
          ) : (
            <ScrollArea className="max-h-[500px]">
              <div className="divide-y divide-border">
                {dispatches.map((d) => {
                  const isExpanded = expandedKey === d.key;
                  return (
                    <DispatchItem
                      key={d.key}
                      group={d}
                      isExpanded={isExpanded}
                      onToggle={() => setExpandedKey(isExpanded ? null : d.key)}
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

/* ── Dispatch Item with lead list ── */
function DispatchItem({ group, isExpanded, onToggle }: {
  group: BroadcastGroup;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const { data: leads, isLoading } = useQuery({
    queryKey: ["dispatch-leads", group.key],
    enabled: isExpanded && (group.leadIds?.length ?? 0) > 0,
    queryFn: async () => {
      const allLeads: any[] = [];
      for (let i = 0; i < group.leadIds.length; i += 100) {
        const batch = group.leadIds.slice(i, i + 100);
        const { data } = await supabase
          .from("leads")
          .select("id, name, phone, photo_url")
          .in("id", batch);
        if (data) allLeads.push(...data);
      }
      return allLeads;
    },
    staleTime: 60000,
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
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {group.type === "flow" && <Zap size={12} className="text-amber-500 shrink-0" />}
            <p className="text-sm font-medium truncate">{group.label}</p>
          </div>
          <p className="text-xs text-muted-foreground">{group.total} lead{group.total !== 1 ? "s" : ""} disparado{group.total !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Badge variant="outline" className="text-[10px]">{group.sent} env</Badge>
          {group.failed > 0 && <Badge variant="destructive" className="text-[10px]">{group.failed} err</Badge>}
        </div>
      </button>

      {isExpanded && (
        <div className="px-4 pb-3 pl-11 bg-muted/20 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="text-center py-2 rounded-md bg-background border border-border">
              <p className="text-lg font-bold">{group.total}</p>
              <p className="text-[10px] text-muted-foreground">Total</p>
            </div>
            <div className="text-center py-2 rounded-md bg-background border border-border">
              <p className="text-lg font-bold text-amber-500">{group.sent}</p>
              <p className="text-[10px] text-muted-foreground">Enviado</p>
            </div>
            <div className="text-center py-2 rounded-md bg-background border border-border">
              <p className="text-lg font-bold text-emerald-500">{group.delivered}</p>
              <p className="text-[10px] text-muted-foreground">Recebido</p>
            </div>
            <div className="text-center py-2 rounded-md bg-background border border-border">
              <p className="text-lg font-bold text-blue-500">{group.read}</p>
              <p className="text-[10px] text-muted-foreground">Lido</p>
            </div>
          </div>

          {(group.leadIds?.length ?? 0) > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Leads enviados</p>
              {isLoading ? (
                <div className="flex items-center gap-2 py-3 justify-center text-muted-foreground">
                  <Loader2 size={14} className="animate-spin" />
                  <span className="text-xs">Carregando leads...</span>
                </div>
              ) : (
                <ScrollArea className="max-h-[200px]">
                  <div className="space-y-0.5">
                    {leads?.map((lead) => (
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
          )}
        </div>
      )}
    </div>
  );
}
