import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Webhook, RefreshCw, Loader2, CheckCircle2, XCircle, AlertTriangle, Activity, Copy } from "lucide-react";
import { toast } from "sonner";

export function InstagramWebhookMonitor() {
  const qc = useQueryClient();
  const [reprocessing, setReprocessing] = useState(false);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["ig-webhook-stats"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("instagram-webhook-stats");
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    refetchInterval: 15000,
  });

  const reprocessAll = async () => {
    setReprocessing(true);
    try {
      const { data, error } = await supabase.functions.invoke("instagram-webhook-reprocess", {
        body: { all_failed: true },
      });
      if (error) throw error;
      toast.success(`Reprocessados: ${data?.reprocessed || 0} • Falhas: ${data?.failed || 0}`);
      qc.invalidateQueries({ queryKey: ["ig-webhook-stats"] });
    } catch (e: any) {
      toast.error(e.message || "Erro ao reprocessar");
    } finally {
      setReprocessing(false);
    }
  };

  const reprocessOne = async (id: string) => {
    try {
      const { data, error } = await supabase.functions.invoke("instagram-webhook-reprocess", {
        body: { event_ids: [id] },
      });
      if (error) throw error;
      if (data?.reprocessed) toast.success("Evento reprocessado");
      else toast.error("Falha ao reprocessar");
      qc.invalidateQueries({ queryKey: ["ig-webhook-stats"] });
    } catch (e: any) {
      toast.error(e.message || "Erro");
    }
  };

  const counts = data?.counts || {};
  const subs = data?.subscriptions || [];
  const failed = data?.failed_events || [];
  const lastOk = data?.last_successful_at;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Webhook className="h-5 w-5 text-purple-500" />
            <CardTitle className="text-base">Monitor de Webhooks</CardTitle>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Atualizar
            </Button>
            {failed.length > 0 && (
              <Button variant="default" size="sm" onClick={reprocessAll} disabled={reprocessing}>
                {reprocessing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                Reprocessar todos ({failed.length})
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}

        {data && (
          <>
            {/* Counts */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Última 1h" value={counts.last_1h ?? 0} />
              <Stat label="Últimas 24h" value={counts.last_24h ?? 0} />
              <Stat label="Últimos 7d" value={counts.last_7d ?? 0} />
              <Stat
                label="Falhos (24h)"
                value={counts.failed_24h ?? 0}
                tone={counts.failed_24h > 0 ? "warn" : "ok"}
              />
            </div>

            {/* Health */}
            <div className="rounded-lg border bg-card p-3 text-sm flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              {lastOk ? (
                <span>
                  Último evento processado:{" "}
                  <strong>{new Date(lastOk).toLocaleString("pt-BR")}</strong>
                  {data.last_successful_type && ` (${data.last_successful_type})`}
                </span>
              ) : (
                <span className="text-amber-600">
                  Nenhum evento da Meta foi recebido ainda. Verifique a configuração do webhook no portal Meta.
                </span>
              )}
            </div>

            {/* Subscriptions */}
            <div className="space-y-2">
              <p className="text-sm font-medium">Assinaturas ativas no Meta</p>
              {subs.length === 0 && (
                <p className="text-xs text-muted-foreground">Nenhuma conexão Instagram conectada.</p>
              )}
              {subs.map((s: any) => (
                <div key={s.connection_id} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="font-medium text-sm">@{s.username}</span>
                    <div className="flex gap-1">
                      {s.page_ok ? (
                        <Badge className="bg-green-500/10 text-green-600 border-green-500/20 text-xs">
                          <CheckCircle2 className="h-3 w-3 mr-1" /> Página OK
                        </Badge>
                      ) : (
                        <Badge className="bg-destructive/10 text-destructive border-destructive/20 text-xs">
                          <XCircle className="h-3 w-3 mr-1" /> Página
                        </Badge>
                      )}
                      {s.ig_ok ? (
                        <Badge className="bg-green-500/10 text-green-600 border-green-500/20 text-xs">
                          <CheckCircle2 className="h-3 w-3 mr-1" /> IG OK
                        </Badge>
                      ) : (
                        <Badge className="bg-destructive/10 text-destructive border-destructive/20 text-xs">
                          <XCircle className="h-3 w-3 mr-1" /> IG
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Página: {s.page_subscribed.join(", ") || "—"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Instagram: {s.ig_subscribed.join(", ") || "—"}
                  </div>
                </div>
              ))}
            </div>

            {/* Verify URL */}
            <div className="rounded-lg border bg-muted/50 p-3 text-xs space-y-1">
              <p className="font-medium">URL do webhook (configure no portal Meta):</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-[11px] break-all">{data.verify_url}</code>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    navigator.clipboard.writeText(data.verify_url);
                    toast.success("Copiado");
                  }}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </div>

            {/* Failed events */}
            {failed.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  Eventos com falha ({failed.length})
                </p>
                <div className="space-y-1 max-h-72 overflow-auto">
                  {failed.map((e: any) => (
                    <div key={e.id} className="rounded border p-2 flex items-center justify-between gap-2 text-xs">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-[10px]">{e.event_type}</Badge>
                          <span className="text-muted-foreground">
                            {new Date(e.received_at).toLocaleString("pt-BR")}
                          </span>
                          <span className="text-muted-foreground">• {e.attempts} tentativa(s)</span>
                        </div>
                        {e.error && (
                          <p className="text-destructive truncate mt-0.5" title={e.error}>{e.error}</p>
                        )}
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => reprocessOne(e.id)}>
                        <RefreshCw className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone = "ok" }: { label: string; value: number; tone?: "ok" | "warn" }) {
  return (
    <div className={`rounded-lg border p-3 ${tone === "warn" && value > 0 ? "border-amber-500/40 bg-amber-500/5" : "bg-card"}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold ${tone === "warn" && value > 0 ? "text-amber-600" : ""}`}>{value}</p>
    </div>
  );
}
