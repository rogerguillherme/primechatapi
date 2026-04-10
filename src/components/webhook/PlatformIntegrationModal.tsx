import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Link2, Code2, Clock, Zap, Copy, Check, Info, Send, Loader2,
  ShoppingCart, CreditCard, QrCode, PackageCheck, RotateCcw, XCircle,
  AlertTriangle, Shield,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

export interface PlatformConfig {
  id: string;
  name: string;
  description: string;
  color: string;
  bgColor: string;
  icon: string; // emoji or text
  webhookUrlSuffix: string;
  instructionSteps: string[];
  supportedEvents: {
    value: string;
    label: string;
    icon: any;
    color: string;
  }[];
  expectedFields: { field: string; required: boolean; description: string }[];
  actions: { action: string; description: string }[];
}

export const PLATFORMS: PlatformConfig[] = [
  {
    id: "hubla",
    name: "Hubla",
    description: "Plataforma de produtos digitais e assinaturas",
    color: "text-emerald-600",
    bgColor: "bg-emerald-500/10",
    icon: "🟢",
    webhookUrlSuffix: "hubla-webhook",
    instructionSteps: [
      "Acesse o painel da Hubla e vá em Integrações → Webhooks",
      "Clique em Adicionar Webhook",
      "Cole a URL acima no campo de endpoint",
      "Selecione os eventos desejados (compra, reembolso, chargeback, etc.)",
      "Salve e teste a integração usando o botão acima",
    ],
    supportedEvents: [
      { value: "compra_aprovada", label: "Compra Aprovada", icon: PackageCheck, color: "text-green-500" },
      { value: "reembolso", label: "Reembolso", icon: RotateCcw, color: "text-orange-500" },
      { value: "cancelamento", label: "Cancelamento", icon: XCircle, color: "text-red-500" },
      { value: "carrinho_abandonado", label: "Carrinho Abandonado", icon: ShoppingCart, color: "text-amber-500" },
      { value: "pix", label: "PIX Não Pago", icon: QrCode, color: "text-emerald-500" },
      { value: "cartao", label: "Cartão Recusado", icon: CreditCard, color: "text-blue-500" },
    ],
    expectedFields: [
      { field: "buyer.phone / customer.phone", required: true, description: "Telefone do comprador" },
      { field: "buyer.name / customer.name", required: false, description: "Nome do comprador" },
      { field: "buyer.email / customer.email", required: false, description: "Email do comprador" },
      { field: "order_id / transaction_id", required: false, description: "ID do pedido" },
      { field: "amount / price / value", required: false, description: "Valor em centavos" },
      { field: "product.name / product_name", required: false, description: "Nome do produto" },
      { field: "payment_method", required: false, description: "Forma de pagamento" },
      { field: "status", required: false, description: "Status do evento" },
    ],
    actions: [
      { action: "Criar Lead", description: "Cria lead com nome, telefone e email do comprador" },
      { action: "Criar Pedido", description: "Registra pedido com valor, produto e pagamento" },
      { action: "Resolver Itens", description: "Vincula itens ao pedido pela composição" },
      { action: "Atualizar Status", description: "Atualiza status em reembolso/cancelamento" },
      { action: "Disparar Fluxo", description: "Inicia fluxo de automação vinculado" },
    ],
  },
  {
    id: "perfectpay",
    name: "Perfect Pay",
    description: "Gateway de pagamento para infoprodutos",
    color: "text-purple-600",
    bgColor: "bg-purple-500/10",
    icon: "💜",
    webhookUrlSuffix: "custom-webhook",
    instructionSteps: [
      "Acesse o painel da Perfect Pay e vá em Configurações → Webhooks",
      "Clique em Novo Webhook",
      "Cole a URL acima no campo de URL de destino",
      "Selecione os eventos: Compra aprovada, Reembolso, Chargeback, Carrinho abandonado",
      "Salve e faça um teste de envio",
    ],
    supportedEvents: [
      { value: "compra_aprovada", label: "Compra Aprovada", icon: PackageCheck, color: "text-green-500" },
      { value: "reembolso", label: "Reembolso", icon: RotateCcw, color: "text-orange-500" },
      { value: "cancelamento", label: "Cancelamento", icon: XCircle, color: "text-red-500" },
      { value: "carrinho_abandonado", label: "Carrinho Abandonado", icon: ShoppingCart, color: "text-amber-500" },
      { value: "pix", label: "PIX Gerado", icon: QrCode, color: "text-emerald-500" },
      { value: "cartao", label: "Cartão Recusado", icon: CreditCard, color: "text-blue-500" },
    ],
    expectedFields: [
      { field: "customer.phone_number", required: true, description: "Telefone do comprador" },
      { field: "customer.full_name", required: false, description: "Nome completo" },
      { field: "customer.email", required: false, description: "Email do comprador" },
      { field: "sale.transaction_code", required: false, description: "Código da transação" },
      { field: "sale.original_offer_price", required: false, description: "Valor da oferta em centavos" },
      { field: "product.name", required: false, description: "Nome do produto" },
      { field: "sale.payment_type", required: false, description: "Tipo de pagamento (credit_card, pix, boleto)" },
    ],
    actions: [
      { action: "Criar Lead", description: "Cria lead com dados do comprador" },
      { action: "Criar Pedido", description: "Registra pedido com valor e produto" },
      { action: "Disparar Fluxo", description: "Inicia fluxo de automação" },
      { action: "Criar Notificação", description: "Notifica sobre o evento recebido" },
    ],
  },
  {
    id: "kiwify",
    name: "Kiwify",
    description: "Plataforma de vendas de produtos digitais",
    color: "text-green-600",
    bgColor: "bg-green-500/10",
    icon: "🥝",
    webhookUrlSuffix: "custom-webhook",
    instructionSteps: [
      "Acesse o painel da Kiwify e vá em Configurações → Integrações",
      "Selecione Webhook e clique em Configurar",
      "Cole a URL acima no campo de endpoint",
      "Marque os eventos desejados (compra aprovada, reembolso, abandono)",
      "Salve a configuração",
    ],
    supportedEvents: [
      { value: "compra_aprovada", label: "Compra Aprovada", icon: PackageCheck, color: "text-green-500" },
      { value: "reembolso", label: "Reembolso", icon: RotateCcw, color: "text-orange-500" },
      { value: "carrinho_abandonado", label: "Carrinho Abandonado", icon: ShoppingCart, color: "text-amber-500" },
      { value: "pix", label: "PIX Aguardando", icon: QrCode, color: "text-emerald-500" },
      { value: "cartao", label: "Cartão Recusado", icon: CreditCard, color: "text-blue-500" },
    ],
    expectedFields: [
      { field: "Customer.mobile", required: true, description: "Telefone do comprador" },
      { field: "Customer.full_name", required: false, description: "Nome completo" },
      { field: "Customer.email", required: false, description: "Email do comprador" },
      { field: "order_id", required: false, description: "ID do pedido" },
      { field: "Product.product_name", required: false, description: "Nome do produto" },
      { field: "Commissions.charge_amount", required: false, description: "Valor cobrado" },
      { field: "payment_method", required: false, description: "Método de pagamento" },
    ],
    actions: [
      { action: "Criar Lead", description: "Cria lead automaticamente" },
      { action: "Criar Pedido", description: "Registra pedido com dados da venda" },
      { action: "Disparar Fluxo", description: "Inicia automação vinculada" },
      { action: "Criar Notificação", description: "Gera notificação no sistema" },
    ],
  },
  {
    id: "hotmart",
    name: "Hotmart",
    description: "Maior plataforma de infoprodutos da América Latina",
    color: "text-orange-600",
    bgColor: "bg-orange-500/10",
    icon: "🔥",
    webhookUrlSuffix: "custom-webhook",
    instructionSteps: [
      "Acesse o painel da Hotmart e vá em Ferramentas → Webhooks (Hottok)",
      "Clique em Configurar novo webhook",
      "Cole a URL acima no campo de URL",
      "Selecione os eventos: PURCHASE_COMPLETE, PURCHASE_REFUNDED, PURCHASE_CANCELED, etc.",
      "Salve e teste",
    ],
    supportedEvents: [
      { value: "compra_aprovada", label: "Compra Aprovada", icon: PackageCheck, color: "text-green-500" },
      { value: "reembolso", label: "Reembolso", icon: RotateCcw, color: "text-orange-500" },
      { value: "cancelamento", label: "Cancelamento", icon: XCircle, color: "text-red-500" },
      { value: "carrinho_abandonado", label: "Carrinho Abandonado", icon: ShoppingCart, color: "text-amber-500" },
      { value: "pix", label: "PIX Gerado", icon: QrCode, color: "text-emerald-500" },
      { value: "cartao", label: "Cartão Recusado", icon: CreditCard, color: "text-blue-500" },
    ],
    expectedFields: [
      { field: "data.buyer.phone", required: true, description: "Telefone do comprador" },
      { field: "data.buyer.name", required: false, description: "Nome completo" },
      { field: "data.buyer.email", required: false, description: "Email do comprador" },
      { field: "data.purchase.transaction", required: false, description: "Código da transação" },
      { field: "data.purchase.price.value", required: false, description: "Valor da compra" },
      { field: "data.product.name", required: false, description: "Nome do produto" },
      { field: "data.purchase.payment.type", required: false, description: "Tipo de pagamento" },
    ],
    actions: [
      { action: "Criar Lead", description: "Cria lead com dados do comprador (Hottok)" },
      { action: "Criar Pedido", description: "Registra pedido com transaction ID" },
      { action: "Atualizar Status", description: "Atualiza pedido em reembolso/cancelamento" },
      { action: "Disparar Fluxo", description: "Inicia fluxo de automação" },
      { action: "Criar Notificação", description: "Gera notificação no sistema" },
    ],
  },
];

interface PlatformIntegrationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  platform: PlatformConfig;
}

export function PlatformIntegrationModal({ open, onOpenChange, platform }: PlatformIntegrationModalProps) {
  const [copied, setCopied] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const queryClient = useQueryClient();

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const webhookUrl = `${supabaseUrl}/functions/v1/${platform.webhookUrlSuffix}`;

  const { data: recentLogs } = useQuery({
    queryKey: ["platform-logs", platform.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("webhook_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      return data || [];
    },
    enabled: open,
    refetchInterval: open ? 5000 : false,
  });

  const copyUrl = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    toast.success("URL copiada!");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTest = async () => {
    setSendingTest(true);
    try {
      const testPayload = {
        _test: true,
        _platform: platform.id,
        timestamp: new Date().toISOString(),
        event_type: "compra_aprovada",
        buyer: { name: "Teste " + platform.name, phone: "5511999990000", email: "teste@teste.com" },
        order_id: `TEST-${platform.id.toUpperCase()}-${Date.now()}`,
        amount: 9700,
        product_name: "Produto Teste",
        status: "approved",
        payment_method: "credit_card",
      };
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(testPayload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("Teste enviado com sucesso!");
      queryClient.invalidateQueries({ queryKey: ["platform-logs", platform.id] });
    } catch (err: any) {
      toast.error(err.message || "Erro ao enviar teste");
    } finally {
      setSendingTest(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl p-0 gap-0 overflow-hidden max-h-[90vh]">
        {/* Branding header */}
        <div className="flex items-center gap-3 px-6 pt-6 pb-3">
          <div className={cn("h-11 w-11 rounded-xl flex items-center justify-center text-lg", platform.bgColor)}>
            {platform.icon}
          </div>
          <div>
            <DialogTitle className="text-base font-semibold">{platform.name}</DialogTitle>
            <p className="text-xs text-muted-foreground">Gerenciar Integração Nativa</p>
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="webhook" className="flex flex-col min-h-0">
          <div className="px-6">
            <TabsList className="w-full justify-start bg-transparent border-b rounded-none h-auto p-0 gap-0">
              {[
                { value: "webhook", icon: Link2, label: "Webhook" },
                { value: "variables", icon: Code2, label: "Variáveis" },
                { value: "history", icon: Clock, label: "Histórico" },
                { value: "actions", icon: Zap, label: "Ações" },
              ].map((tab) => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className="gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none px-4 py-2.5 text-sm font-medium text-muted-foreground"
                >
                  <tab.icon className="h-3.5 w-3.5" />
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <ScrollArea className="flex-1 max-h-[60vh]">
            <div className="px-6 py-5">
              {/* Webhook Tab */}
              <TabsContent value="webhook" className="mt-0 space-y-6">
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold">URL do Webhook</h3>
                  <p className="text-xs text-muted-foreground">Use esta URL para receber notificações da integração {platform.name}.</p>
                  <div className="flex gap-2">
                    <Input value={webhookUrl} readOnly className="font-mono text-[11px] bg-muted/50" />
                    <Button variant="outline" onClick={copyUrl} className="shrink-0 gap-2 border-primary/30 text-primary hover:bg-primary/5 text-xs">
                      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      {copied ? "Copiado" : "Copiar"}
                    </Button>
                  </div>
                  <div className="flex items-start gap-2 rounded-lg bg-primary/5 border border-primary/20 p-3">
                    <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <div className="text-xs">
                      <span className="font-medium">Como usar:</span>{" "}
                      <span className="text-muted-foreground">Configure esta URL no painel da {platform.name} para receber notificações em tempo real.</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <h3 className="text-sm font-semibold">Teste de Webhook</h3>
                  <p className="text-xs text-muted-foreground">Teste se o webhook está funcionando corretamente aguardando um evento.</p>
                  <Button onClick={handleTest} disabled={sendingTest} className="gap-2 text-sm">
                    {sendingTest ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {sendingTest ? "Aguardando..." : "Aguardar Evento"}
                  </Button>
                </div>

                {/* Instructions */}
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold">Como Configurar na {platform.name}</h3>
                  <ol className="space-y-1.5 text-xs text-muted-foreground list-decimal list-inside">
                    {platform.instructionSteps.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ol>
                </div>

                {/* Supported events */}
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <Shield className="h-4 w-4 text-primary" />
                    Eventos Suportados
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    {platform.supportedEvents.map((evt) => {
                      const Icon = evt.icon;
                      return (
                        <div key={evt.value} className="flex items-center gap-2 p-2 rounded-lg border bg-muted/20">
                          <Icon size={14} className={evt.color} />
                          <span className="text-xs font-medium">{evt.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </TabsContent>

              {/* Variables Tab */}
              <TabsContent value="variables" className="mt-0 space-y-4">
                <div>
                  <h3 className="text-sm font-semibold flex items-center gap-2 mb-1">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    Campos do Payload
                  </h3>
                  <p className="text-xs text-muted-foreground mb-3">Campos esperados no JSON enviado pela {platform.name}.</p>
                  <div className="divide-y divide-border rounded-lg border">
                    {platform.expectedFields.map((f) => (
                      <div key={f.field} className="flex items-start justify-between px-3 py-2.5 gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-mono">{f.field}</p>
                          <p className="text-[11px] text-muted-foreground">{f.description}</p>
                        </div>
                        <Badge variant={f.required ? "default" : "secondary"} className="shrink-0 text-[10px]">
                          {f.required ? "Obrigatório" : "Opcional"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              </TabsContent>

              {/* History Tab */}
              <TabsContent value="history" className="mt-0 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Últimos Eventos</h3>
                  <Badge variant="outline" className="text-[10px]">{recentLogs?.length || 0} registros</Badge>
                </div>
                {!recentLogs || recentLogs.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic py-6 text-center">Nenhum evento registrado ainda.</p>
                ) : (
                  <div className="space-y-2">
                    {recentLogs.map((log: any) => (
                      <div key={log.id} className="flex items-start gap-2 text-xs p-2.5 rounded-lg bg-muted/30 border">
                        <Badge
                          variant={log.http_status < 400 ? "default" : "destructive"}
                          className="text-[9px] px-1.5 shrink-0"
                        >
                          {log.http_status}
                        </Badge>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-muted-foreground">
                              {format(new Date(log.created_at), "dd/MM HH:mm:ss", { locale: ptBR })}
                            </span>
                            {log.event_status && (
                              <Badge variant="outline" className="text-[9px]">{log.event_status}</Badge>
                            )}
                          </div>
                          {log.response_message && (
                            <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{log.response_message}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* Actions Tab */}
              <TabsContent value="actions" className="mt-0 space-y-3">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Zap className="h-4 w-4 text-primary" />
                  Ações Automáticas
                </h3>
                <p className="text-xs text-muted-foreground">Ações executadas automaticamente quando um webhook da {platform.name} é recebido.</p>
                <div className="divide-y divide-border rounded-lg border">
                  {platform.actions.map((a) => (
                    <div key={a.action} className="flex items-start justify-between px-3 py-2.5 gap-3">
                      <div>
                        <p className="text-xs font-medium">{a.action}</p>
                        <p className="text-[11px] text-muted-foreground">{a.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </TabsContent>
            </div>
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
