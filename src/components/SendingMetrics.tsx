import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { WhatsAppLimits } from "./WhatsAppLimits";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Send, CheckCheck, Eye, Inbox, RefreshCw, ChevronDown, ChevronRight, MessageCircle,
  FileText, Loader2, CheckCircle2, AlertCircle,
} from "lucide-react";
import { useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useWhatsAppAccounts } from "@/hooks/use-whatsapp-accounts";
import { toast } from "sonner";

interface BroadcastGroup {
  key: string;
  label: string;
  total: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
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
  const [syncingTemplates, setSyncingTemplates] = useState(false);
  const { accounts } = useWhatsAppAccounts();

  const handleRefresh = () => {
    setRefreshing(true);
    queryClient.invalidateQueries({ queryKey: ["sending-metrics-summary"] });
    queryClient.invalidateQueries({ queryKey: ["sending-metrics-dispatches"] });
    queryClient.invalidateQueries({ queryKey: ["sending-metrics-by-account"] });
    queryClient.invalidateQueries({ queryKey: ["template-sync-stats"] });
    setTimeout(() => setRefreshing(false), 800);
  };

  const handleSyncTemplates = async () => {
    setSyncingTemplates(true);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-sync-templates", { body: {} });
      if (error) throw error;
      const results = data?.results || [];
      const totalSynced = results.reduce((acc: number, r: any) => acc + (r.synced || 0), 0);
      const errors = results.filter((r: any) => r.error);
      if (errors.length > 0) {
        toast.error(`Erro em ${errors.length} conta(s): ${errors[0].error}`);
      } else {
        toast.success(`${totalSynced} template(s) sincronizado(s)!`);
      }
      queryClient.invalidateQueries({ queryKey: ["user-templates"] });
      queryClient.invalidateQueries({ queryKey: ["template-sync-stats"] });
    } catch (err: any) {
      toast.error(`Erro ao sincronizar: ${err.message}`);
    } finally {
      setSyncingTemplates(false);
    }
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

  const { data: accountStats } = useQuery({
    queryKey: ["sending-metrics-by-account"],
    queryFn: async () => {
      const { data: outbound } = await supabase
        .from("chat_messages")
        .select("status, delivered_at, read_at, account_id")
        .eq("direction", "outbound");

      if (!outbound || outbound.length === 0 || accounts.length === 0) return [] as AccountStats[];

      const map = new Map<string, AccountStats>();
      for (const acc of accounts) {
        map.set(acc.id, { id: acc.id, name: acc.name, total: 0, sent: 0, delivered: 0, read: 0, failed: 0 });
      }
      // For messages without account_id
      map.set("unknown", { id: "unknown", name: "Sem conta", total: 0, sent: 0, delivered: 0, read: 0, failed: 0 });

      for (const msg of outbound) {
        const key = msg.account_id && map.has(msg.account_id) ? msg.account_id : "unknown";
        const entry = map.get(key)!;
        entry.total++;
        if (["sent", "delivered", "read"].includes(msg.status)) entry.sent++;
        if (msg.status === "delivered" || msg.status === "read" || msg.delivered_at) entry.delivered++;
        if (msg.status === "read" || msg.read_at) entry.read++;
        if (msg.status === "failed") entry.failed++;
      }

      return Array.from(map.values()).filter(a => a.total > 0);
    },
    enabled: accounts.length > 0,
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
      {/* WhatsApp Limits */}
      <WhatsAppLimits />

      {/* Template Sync */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText size={16} /> Templates da Meta
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSyncTemplates}
              disabled={syncingTemplates}
              className="gap-1.5"
            >
              {syncingTemplates ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              Sincronizar
            </Button>
          </div>
          <CardDescription className="text-xs">
            Sincronize os templates aprovados da Meta para usar nos disparos e fluxos.
          </CardDescription>
        </CardHeader>
      </Card>

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
