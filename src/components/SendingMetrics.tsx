import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Send, CheckCheck, Eye, Inbox, RefreshCw, ChevronDown, ChevronRight,
} from "lucide-react";
import { useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

interface BroadcastGroup {
  key: string;
  label: string;
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

  const handleRefresh = () => {
    setRefreshing(true);
    queryClient.invalidateQueries({ queryKey: ["sending-metrics-summary"] });
    queryClient.invalidateQueries({ queryKey: ["sending-metrics-dispatches"] });
    setTimeout(() => setRefreshing(false), 800);
  };

  const { data: stats, isLoading } = useQuery({
    queryKey: ["sending-metrics-summary"],
    queryFn: async () => {
      const { data: outbound } = await supabase
        .from("chat_messages")
        .select("status, delivered_at, read_at")
        .eq("direction", "outbound");

      const total = outbound?.length || 0;
      const sent = outbound?.filter(m => ["sent", "delivered", "read"].includes(m.status)).length || 0;
      const delivered = outbound?.filter(m => m.status === "delivered" || m.status === "read" || m.delivered_at).length || 0;
      const read = outbound?.filter(m => m.status === "read" || m.read_at).length || 0;

      return { total, sent, delivered, read };
    },
    refetchInterval: 30000,
  });

  const { data: dispatches, isLoading: loadingDispatches } = useQuery({
    queryKey: ["sending-metrics-dispatches"],
    queryFn: async () => {
      const { data: outbound } = await supabase
        .from("chat_messages")
        .select("status, delivered_at, read_at, created_at, content")
        .eq("direction", "outbound")
        .order("created_at", { ascending: false });

      if (!outbound || outbound.length === 0) return [] as BroadcastGroup[];

      // Group messages by dispatch batches (messages within 5 min window)
      const groups: BroadcastGroup[] = [];
      let current: typeof outbound = [];
      let currentStart: Date | null = null;

      for (const msg of outbound) {
        const msgDate = new Date(msg.created_at);
        if (!currentStart || (currentStart.getTime() - msgDate.getTime()) > 5 * 60 * 1000) {
          if (current.length > 0 && currentStart) {
            groups.push(buildGroup(current, currentStart));
          }
          current = [msg];
          currentStart = msgDate;
        } else {
          current.push(msg);
        }
      }
      if (current.length > 0 && currentStart) {
        groups.push(buildGroup(current, currentStart));
      }

      return groups;
    },
    refetchInterval: 30000,
  });

  function buildGroup(msgs: any[], startDate: Date): BroadcastGroup {
    const dateStr = format(startDate, "dd/MM/yyyy HH:mm", { locale: ptBR });
    return {
      key: startDate.toISOString(),
      label: `Disparo ${dateStr}`,
      total: msgs.length,
      sent: msgs.filter(m => ["sent", "delivered", "read"].includes(m.status)).length,
      delivered: msgs.filter(m => m.status === "delivered" || m.status === "read" || m.delivered_at).length,
      read: msgs.filter(m => m.status === "read" || m.read_at).length,
      failed: msgs.filter(m => m.status === "failed").length,
    };
  }

  const pct = (n: number, t: number) => t > 0 ? `${Math.round((n / t) * 100)}%` : "—";

  const metrics = [
    { label: "Total", value: stats?.total || 0, icon: <Send size={18} />, colorClass: "text-primary" },
    { label: "Enviado", value: stats?.sent || 0, icon: <CheckCheck size={18} />, colorClass: "text-amber-500", percent: pct(stats?.sent || 0, stats?.total || 0) },
    { label: "Recebido", value: stats?.delivered || 0, icon: <Inbox size={18} />, colorClass: "text-emerald-500", percent: pct(stats?.delivered || 0, stats?.total || 0) },
    { label: "Lido", value: stats?.read || 0, icon: <Eye size={18} />, colorClass: "text-blue-500", percent: pct(stats?.read || 0, stats?.total || 0) },
  ];

  return (
    <div className="space-y-4">
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
            <ScrollArea className="max-h-[400px]">
              <div className="divide-y divide-border">
                {dispatches.map((d) => {
                  const isExpanded = expandedKey === d.key;
                  return (
                    <div key={d.key}>
                      <button
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent/30 transition-colors text-left"
                        onClick={() => setExpandedKey(isExpanded ? null : d.key)}
                      >
                        <span className="text-muted-foreground shrink-0">
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{d.label}</p>
                          <p className="text-xs text-muted-foreground">{d.total} mensagen{d.total !== 1 ? "s" : ""}</p>
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="px-4 pb-3 pl-11 bg-muted/20">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <div className="text-center py-2 rounded-md bg-background border border-border">
                              <p className="text-lg font-bold">{d.total}</p>
                              <p className="text-[10px] text-muted-foreground">Total</p>
                            </div>
                            <div className="text-center py-2 rounded-md bg-background border border-border">
                              <p className="text-lg font-bold text-amber-500">{d.sent}</p>
                              <p className="text-[10px] text-muted-foreground">Enviado</p>
                            </div>
                            <div className="text-center py-2 rounded-md bg-background border border-border">
                              <p className="text-lg font-bold text-emerald-500">{d.delivered}</p>
                              <p className="text-[10px] text-muted-foreground">Recebido</p>
                            </div>
                            <div className="text-center py-2 rounded-md bg-background border border-border">
                              <p className="text-lg font-bold text-blue-500">{d.read}</p>
                              <p className="text-[10px] text-muted-foreground">Lido</p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
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
