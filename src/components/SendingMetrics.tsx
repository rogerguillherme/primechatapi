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
  Loader2,
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
      // Derive metrics from broadcast_jobs (has user RLS) instead of chat_messages (open)
      const { data: jobs } = await supabase
        .from("broadcast_jobs")
        .select("total_leads, sent_count, delivered_count, read_count, error_count");

      if (!jobs || jobs.length === 0) return { total: 0, sent: 0, delivered: 0, read: 0 };

      const total = jobs.reduce((sum, j) => sum + (j.total_leads || 0), 0);
      const sent = jobs.reduce((sum, j) => sum + (j.sent_count || 0), 0);
      const delivered = jobs.reduce((sum, j) => sum + (j.delivered_count || 0), 0);
      const read = jobs.reduce((sum, j) => sum + (j.read_count || 0), 0);

      return { total, sent, delivered, read };
    },
    refetchInterval: 30000,
  });

  const { data: accountStats } = useQuery({
    queryKey: ["sending-metrics-by-account"],
    queryFn: async () => {
      // Get all user's broadcast jobs (RLS filters by user_id)
      const { data: jobs } = await supabase
        .from("broadcast_jobs")
        .select("id, account_id, total_leads, sent_count, delivered_count, read_count, error_count");

      if (!jobs || jobs.length === 0 || accounts.length === 0) return [] as AccountStats[];

      // Group by account_id
      const accountMap = new Map<string, { total: number; sent: number; delivered: number; read: number; failed: number }>();

      for (const job of jobs) {
        const accId = job.account_id || "unknown";
        const cur = accountMap.get(accId) || { total: 0, sent: 0, delivered: 0, read: 0, failed: 0 };
        cur.total += job.total_leads || 0;
        cur.sent += job.sent_count || 0;
        cur.delivered += job.delivered_count || 0;
        cur.read += job.read_count || 0;
        cur.failed += job.error_count || 0;
        accountMap.set(accId, cur);
      }

      const result: AccountStats[] = [];
      for (const acc of accounts) {
        const stats = accountMap.get(acc.id);
        if (!stats || stats.total === 0) continue;
        result.push({ id: acc.id, name: acc.name, ...stats });
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
      const { data: jobs } = await supabase
        .from("broadcast_jobs")
        .select("id, created_at, total_leads, sent_count, delivered_count, read_count, error_count, lead_ids")
        .order("created_at", { ascending: false });

      if (!jobs || jobs.length === 0) return [] as BroadcastGroup[];

      return jobs.map((job): BroadcastGroup => {
        const dateStr = format(new Date(job.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR });
        return {
          key: job.id,
          label: `Disparo ${dateStr}`,
          total: job.total_leads || job.lead_ids?.length || 0,
          sent: job.sent_count || 0,
          delivered: job.delivered_count || 0,
          read: job.read_count || 0,
          failed: job.error_count || 0,
          leadIds: job.lead_ids || [],
        };
      });
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
      {/* WhatsApp Limits */}
      <WhatsAppLimits />

      {/* Header with refresh */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">Métricas gerais</h3>
        <Button variant="outline" size="sm" onClick={handleRefresh} className="gap-1.5">
          <RefreshCw size={14} className={cn(refreshing && "animate-spin")} />
          Atualizar
        </Button>
      </div>

      {/* Summary Cards */}
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

      {/* Per-account stats */}
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

      {/* Dispatches list */}
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
      // Fetch in batches of 100 (supabase .in() limit)
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
          <p className="text-sm font-medium">{group.label}</p>
          <p className="text-xs text-muted-foreground">{group.total} lead{group.total !== 1 ? "s" : ""} disparado{group.total !== 1 ? "s" : ""}</p>
        </div>
      </button>

      {isExpanded && (
        <div className="px-4 pb-3 pl-11 bg-muted/20 space-y-3">
          {/* Stats */}
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

          {/* Leads list */}
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
