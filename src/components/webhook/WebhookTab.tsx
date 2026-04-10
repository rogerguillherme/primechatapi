import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Copy, Check, RefreshCw, Info } from "lucide-react";
import { toast } from "sonner";

const WEBHOOK_URL = `https://armfsrtrktsxcexsehpe.supabase.co/functions/v1/hubla-webhook`;

export function WebhookTab() {
  const [copied, setCopied] = useState(false);
  const [waiting, setWaiting] = useState(false);

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
      setWaiting(false);
    },
    onError: (err: any) => {
      toast.error("Erro no teste", { description: err.message });
      setWaiting(false);
    },
  });

  return (
    <div className="space-y-8">
      {/* URL do Webhook */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold">URL do Webhook</h3>
        <p className="text-sm text-muted-foreground">Use esta URL para receber notificações da integração Hubla.</p>
        <div className="flex gap-2">
          <Input value={WEBHOOK_URL} readOnly className="font-mono text-xs bg-muted/50 border" />
          <Button variant="outline" onClick={copyUrl} className="shrink-0 gap-2 border-primary text-primary hover:bg-primary/5">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copiado" : "Copiar"}
          </Button>
        </div>

        <div className="flex items-start gap-2 rounded-lg bg-primary/5 border border-primary/20 p-3">
          <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div className="text-sm">
            <span className="font-medium">Como usar:</span>{" "}
            <span className="text-muted-foreground">Configure esta URL no painel da Hubla para receber notificações em tempo real.</span>
          </div>
        </div>
      </div>

      {/* Teste de Webhook */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold">Teste de Webhook</h3>
        <p className="text-sm text-muted-foreground">Teste se o webhook está funcionando corretamente aguardando um evento.</p>
        <Button
          onClick={() => {
            setWaiting(true);
            testMutation.mutate();
          }}
          disabled={testMutation.isPending}
          className="gap-2 bg-primary hover:bg-primary/90"
        >
          <RefreshCw className={`h-4 w-4 ${testMutation.isPending ? "animate-spin" : ""}`} />
          {testMutation.isPending ? "Aguardando..." : "Aguardar Evento"}
        </Button>
      </div>
    </div>
  );
}
