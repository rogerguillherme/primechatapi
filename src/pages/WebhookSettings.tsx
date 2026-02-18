import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Copy, Check, ExternalLink, Webhook, Shield, RefreshCw, AlertTriangle, Activity } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { StatusBadge } from "@/components/StatusBadge";
import { DataTable } from "@/components/DataTable";

const WEBHOOK_URL = `https://armfsrtrktsxcexsehpe.supabase.co/functions/v1/hubla-webhook`;

const EVENT_TYPES = [
  { event: "Compra aprovada", status: "approved", description: "Cria pedido + lead + itens automaticamente" },
  { event: "Pagamento confirmado", status: "paid", description: "Atualiza status para pago" },
  { event: "Reembolso", status: "refunded", description: "Atualiza status para reembolsado" },
  { event: "Chargeback", status: "chargeback", description: "Atualiza status para chargeback" },
  { event: "Cancelamento", status: "cancelled", description: "Atualiza status para cancelado" },
];

const EXPECTED_FIELDS = [
  { field: "order_id / id / transaction_id", required: true, description: "Identificador único do pedido" },
  { field: "buyer.phone / customer.phone", required: true, description: "Telefone do comprador (identificação do lead)" },
  { field: "buyer.name / customer.name", required: false, description: "Nome do comprador" },
  { field: "buyer.email / customer.email", required: false, description: "Email do comprador" },
  { field: "product.name / product_name", required: false, description: "Nome do produto para resolver composição" },
  { field: "amount / price / value", required: false, description: "Valor em centavos (convertido para R$)" },
  { field: "payment_method", required: false, description: "Forma de pagamento" },
  { field: "status", required: false, description: "Status do pedido (default: approved)" },
];

export default function WebhookSettings() {
  const [copied, setCopied] = useState(false);

  const copyUrl = () => {
    navigator.clipboard.writeText(WEBHOOK_URL);
    setCopied(true);
    toast.success("URL copiada!");
    setTimeout(() => setCopied(false), 2000);
  };

  const { data: webhookLogs, isLoading: logsLoading } = useQuery({
    queryKey: ["webhook-logs"],
    queryFn: async () => {
      const { data } = await supabase
        .from("webhook_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
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

  const testMutation = useMutation({
    mutationFn: async () => {
      const testPayload = {
        order_id: `TEST-${Date.now()}`,
        buyer: { name: "Teste Webhook", email: "teste@webhook.com", phone: "5511999990000" },
        product_name: "Teste",
        amount: 0,
        status: "approved",
        payment_method: "test",
      };
      const res = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(testPayload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast.success("Webhook testado com sucesso!", { description: `Order ID: ${data.order_id?.slice(0, 8)}...` });
    },
    onError: (err: any) => {
      toast.error("Erro no teste", { description: err.message });
    },
  });

  return (
    <div>
      <PageHeader title="Configurações de Webhook" description="Configure a integração com a Hubla para receber pedidos automaticamente." />

      <div className="grid gap-6 max-w-3xl">
        {/* Webhook URL */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Webhook className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">URL do Webhook</CardTitle>
            </div>
            <CardDescription>Cole esta URL na configuração de webhooks da Hubla.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input value={WEBHOOK_URL} readOnly className="font-mono text-xs bg-muted" />
              <Button variant="outline" size="icon" onClick={copyUrl} className="shrink-0">
                {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">POST</Badge>
              <Badge variant="outline" className="text-xs">JSON</Badge>
              <Badge className="text-xs bg-success/15 text-success border-success/30">Ativo</Badge>
            </div>
          </CardContent>
        </Card>

        {/* Test */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Testar Webhook</CardTitle>
            </div>
            <CardDescription>Envia um payload de teste para verificar se a integração está funcionando.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => testMutation.mutate()} disabled={testMutation.isPending} variant="outline">
              <RefreshCw className={`h-4 w-4 mr-2 ${testMutation.isPending ? "animate-spin" : ""}`} />
              {testMutation.isPending ? "Enviando..." : "Enviar Teste"}
            </Button>
          </CardContent>
        </Card>

        {/* Webhook Logs */}
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
            <CardDescription>Últimos 20 webhooks recebidos (atualiza a cada 10s).</CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable columns={logColumns} data={webhookLogs || []} emptyMessage={logsLoading ? "Carregando..." : "Nenhum webhook recebido ainda."} />
          </CardContent>
        </Card>

        {/* Event types */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Eventos Suportados</CardTitle>
            </div>
            <CardDescription>O webhook processa automaticamente os seguintes tipos de evento.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-border">
              {EVENT_TYPES.map((ev) => (
                <div key={ev.status} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                  <div>
                    <p className="text-sm font-medium">{ev.event}</p>
                    <p className="text-xs text-muted-foreground">{ev.description}</p>
                  </div>
                  <Badge variant="outline" className="font-mono text-xs">{ev.status}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Payload fields */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              <CardTitle className="text-base">Campos do Payload</CardTitle>
            </div>
            <CardDescription>Campos esperados no JSON do webhook. O sistema tenta múltiplas variações de nome.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-border">
              {EXPECTED_FIELDS.map((f) => (
                <div key={f.field} className="flex items-start justify-between py-3 first:pt-0 last:pb-0 gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-mono text-xs">{f.field}</p>
                    <p className="text-xs text-muted-foreground">{f.description}</p>
                  </div>
                  <Badge variant={f.required ? "default" : "secondary"} className="shrink-0 text-xs">
                    {f.required ? "Obrigatório" : "Opcional"}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Instructions */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ExternalLink className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Como Configurar na Hubla</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
              <li>Acesse o painel da Hubla e vá em <strong className="text-foreground">Integrações → Webhooks</strong></li>
              <li>Clique em <strong className="text-foreground">Adicionar Webhook</strong></li>
              <li>Cole a URL acima no campo de endpoint</li>
              <li>Selecione os eventos desejados (compra, reembolso, chargeback, etc.)</li>
              <li>Salve e teste a integração usando o botão acima</li>
            </ol>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
