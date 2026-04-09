import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Copy, Check, RefreshCw, Info, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";

const WEBHOOK_URL = `https://armfsrtrktsxcexsehpe.supabase.co/functions/v1/hubla-webhook`;

export function WebhookTab() {
  const [copied, setCopied] = useState(false);
  const [waitingEvent, setWaitingEvent] = useState(false);

  const copyUrl = () => {
    navigator.clipboard.writeText(WEBHOOK_URL);
    setCopied(true);
    toast.success("URL copiada!");
    setTimeout(() => setCopied(false), 2000);
  };

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
      setWaitingEvent(false);
    },
    onError: (err: any) => {
      toast.error("Erro no teste", { description: err.message });
      setWaitingEvent(false);
    },
  });

  return (
    <div className="space-y-6">
      {/* URL do Webhook */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">URL do Webhook</CardTitle>
          <CardDescription>Use esta URL para receber notificações da integração Hubla.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input value={WEBHOOK_URL} readOnly className="font-mono text-xs bg-muted" />
            <Button variant="outline" onClick={copyUrl} className="shrink-0 gap-2">
              {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copiado" : "Copiar"}
            </Button>
          </div>

          <Alert className="bg-accent/50 border-accent">
            <Info className="h-4 w-4" />
            <AlertDescription>
              <strong>Como usar:</strong> Configure esta URL no painel da Hubla para receber notificações em tempo real.
            </AlertDescription>
          </Alert>

          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">POST</Badge>
            <Badge variant="outline" className="text-xs">JSON</Badge>
            <Badge className="text-xs bg-success/15 text-success border-success/30">Ativo</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Teste de Webhook */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Teste de Webhook</CardTitle>
          <CardDescription>Teste se o webhook está funcionando corretamente enviando um evento de teste.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            onClick={() => {
              setWaitingEvent(true);
              testMutation.mutate();
            }}
            disabled={testMutation.isPending}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${testMutation.isPending ? "animate-spin" : ""}`} />
            {testMutation.isPending ? "Enviando..." : "Enviar Teste"}
          </Button>
        </CardContent>
      </Card>

      {/* Instruções */}
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
  );
}
