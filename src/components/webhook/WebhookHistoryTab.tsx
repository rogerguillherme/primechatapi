import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { StatusBadge } from "@/components/StatusBadge";
import { DataTable } from "@/components/DataTable";

export function WebhookHistoryTab() {
  const { data: webhookLogs, isLoading: logsLoading } = useQuery({
    queryKey: ["webhook-logs"],
    queryFn: async () => {
      const { data } = await supabase
        .from("webhook_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      return data || [];
    },
    refetchInterval: 10000,
  });

  const totalWebhooks = webhookLogs?.length ?? 0;
  const successWebhooks = webhookLogs?.filter((l: any) => l.http_status < 400).length ?? 0;
  const errorWebhooks = webhookLogs?.filter((l: any) => l.http_status >= 400).length ?? 0;

  const logColumns = [
    {
      key: "created_at",
      header: "Data",
      render: (row: any) => format(new Date(row.created_at), "dd/MM HH:mm:ss", { locale: ptBR }),
    },
    { key: "external_order_id", header: "Order ID", render: (row: any) => row.external_order_id || "—" },
    { key: "event_status", header: "Evento", render: (row: any) => <StatusBadge status={row.event_status || "unknown"} /> },
    {
      key: "http_status",
      header: "HTTP",
      render: (row: any) => (
        <Badge variant={row.http_status < 400 ? "default" : "destructive"} className="text-xs font-mono">
          {row.http_status}
        </Badge>
      ),
    },
    { key: "response_message", header: "Resposta", render: (row: any) => <span className="text-xs text-muted-foreground">{row.response_message}</span> },
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Log de Webhooks Recebidos</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">{totalWebhooks} total</Badge>
            <Badge className="text-xs bg-success/15 text-success border-success/30">{successWebhooks} ok</Badge>
            {errorWebhooks > 0 && (
              <Badge variant="destructive" className="text-xs">{errorWebhooks} erros</Badge>
            )}
          </div>
        </div>
        <CardDescription>Últimos 50 webhooks recebidos (atualiza a cada 10s).</CardDescription>
      </CardHeader>
      <CardContent>
        <DataTable columns={logColumns} data={webhookLogs || []} emptyMessage={logsLoading ? "Carregando..." : "Nenhum webhook recebido ainda."} />
      </CardContent>
    </Card>
  );
}
