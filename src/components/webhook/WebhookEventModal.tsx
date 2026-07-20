import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  Link2, Code2, Clock, Zap, Copy, Check, RefreshCw, Info,
  ShoppingCart, CreditCard, QrCode, PackageCheck, RotateCcw, XCircle,
  Send, Loader2,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

const EVENT_META: Record<string, { label: string; icon: any; color: string }> = {
  carrinho_abandonado: { label: "Carrinho Abandonado", icon: ShoppingCart, color: "text-amber-500 bg-amber-500/10" },
  pix: { label: "Pix", icon: QrCode, color: "text-emerald-500 bg-emerald-500/10" },
  cartao: { label: "Cartão", icon: CreditCard, color: "text-blue-500 bg-blue-500/10" },
  compra_aprovada: { label: "Compra Aprovada", icon: PackageCheck, color: "text-green-500 bg-green-500/10" },
  reembolso: { label: "Reembolso", icon: RotateCcw, color: "text-orange-500 bg-orange-500/10" },
  cancelamento: { label: "Cancelamento", icon: XCircle, color: "text-red-500 bg-red-500/10" },
};

const EXPECTED_FIELDS: Record<string, { field: string; required: boolean; description: string }[]> = {
  carrinho_abandonado: [
    { field: "customer.phone", required: true, description: "Telefone do cliente" },
    { field: "customer.name", required: false, description: "Nome do cliente" },
    { field: "customer.email", required: false, description: "Email do cliente" },
    { field: "cart.total", required: false, description: "Valor total do carrinho" },
    { field: "cart.product", required: false, description: "Produto abandonado" },
  ],
  pix: [
    { field: "customer.phone", required: true, description: "Telefone do cliente" },
    { field: "customer.name", required: false, description: "Nome do cliente" },
    { field: "payment.amount", required: false, description: "Valor do PIX gerado" },
    { field: "payment.status", required: false, description: "Status do pagamento" },
  ],
  cartao: [
    { field: "customer.phone", required: true, description: "Telefone do cliente" },
    { field: "customer.name", required: false, description: "Nome do cliente" },
    { field: "payment.amount", required: false, description: "Valor da tentativa" },
    { field: "payment.status", required: false, description: "Status (recusado, etc)" },
  ],
  compra_aprovada: [
    { field: "customer.phone", required: true, description: "Telefone do comprador" },
    { field: "customer.name", required: false, description: "Nome do comprador" },
    { field: "customer.email", required: false, description: "Email do comprador" },
    { field: "order.id", required: false, description: "ID do pedido" },
    { field: "order.amount", required: false, description: "Valor da compra" },
    { field: "order.product", required: false, description: "Nome do produto" },
  ],
  reembolso: [
    { field: "customer.phone", required: true, description: "Telefone do comprador" },
    { field: "refund.order_id", required: false, description: "ID do pedido original" },
    { field: "refund.amount", required: false, description: "Valor reembolsado" },
    { field: "refund.reason", required: false, description: "Motivo do reembolso" },
  ],
  cancelamento: [
    { field: "customer.phone", required: true, description: "Telefone do comprador" },
    { field: "cancellation.order_id", required: false, description: "ID do pedido cancelado" },
    { field: "cancellation.reason", required: false, description: "Motivo do cancelamento" },
  ],
};

const ACTIONS: Record<string, { action: string; description: string }[]> = {
  carrinho_abandonado: [
    { action: "Criar Lead", description: "Cria lead com dados do cliente automaticamente" },
    { action: "Disparar Fluxo", description: "Inicia fluxo de recuperação de carrinho" },
    { action: "Criar Notificação", description: "Notifica sobre o carrinho abandonado" },
  ],
  pix: [
    { action: "Criar Lead", description: "Cria lead com dados do cliente" },
    { action: "Disparar Fluxo", description: "Inicia fluxo de lembrete de PIX" },
    { action: "Criar Notificação", description: "Notifica sobre PIX pendente" },
  ],
  cartao: [
    { action: "Criar Lead", description: "Cria lead com dados do cliente" },
    { action: "Disparar Fluxo", description: "Inicia fluxo de recuperação de cartão" },
    { action: "Criar Notificação", description: "Notifica sobre cartão recusado" },
  ],
  compra_aprovada: [
    { action: "Criar Lead", description: "Cria lead com nome, telefone e email" },
    { action: "Criar Pedido", description: "Registra pedido com valor e produto" },
    { action: "Resolver Itens", description: "Vincula itens ao pedido pela composição" },
    { action: "Disparar Fluxo", description: "Inicia fluxo pós-venda" },
  ],
  reembolso: [
    { action: "Atualizar Status", description: "Atualiza pedido para reembolsado" },
    { action: "Disparar Fluxo", description: "Inicia fluxo de reembolso" },
    { action: "Criar Notificação", description: "Notifica sobre o reembolso" },
  ],
  cancelamento: [
    { action: "Atualizar Status", description: "Atualiza pedido para cancelado" },
    { action: "Disparar Fluxo", description: "Inicia fluxo de cancelamento" },
    { action: "Criar Notificação", description: "Notifica sobre o cancelamento" },
  ],
};

const FIELD_MAPPING_FIELDS = [
  { key: "phone", label: "Telefone", required: true, placeholder: "customer.phone, telefone, phone" },
  { key: "name", label: "Nome", required: false, placeholder: "customer.name, nome, name" },
  { key: "email", label: "Email", required: false, placeholder: "customer.email, email" },
  { key: "cpf", label: "CPF / Documento", required: false, placeholder: "customer.document, cpf, documento" },
  { key: "order_id", label: "Pedido", required: false, placeholder: "order.id, pedido, id" },
  { key: "amount", label: "Valor", required: false, placeholder: "order.amount, valor, totalCents" },
  { key: "product_name", label: "Produto", required: false, placeholder: "order.product, produto, product.name" },
] as const;

type FieldMappingKey = typeof FIELD_MAPPING_FIELDS[number]["key"];
type FieldMapping = Partial<Record<FieldMappingKey, string>>;

function normalizeFieldMapping(value: unknown): FieldMapping {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  return FIELD_MAPPING_FIELDS.reduce<FieldMapping>((acc, field) => {
    const path = input[field.key];
    if (typeof path === "string" && path.trim()) acc[field.key] = path.trim();
    return acc;
  }, {});
}

function extractPayloadPaths(value: unknown, prefix = "", depth = 0): string[] {
  if (!value || typeof value !== "object" || depth > 4) return [];
  if (Array.isArray(value)) {
    return value[0] ? extractPayloadPaths(value[0], `${prefix}[0]`, depth + 1) : [];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === "object") {
      return [path, ...extractPayloadPaths(child, path, depth + 1)];
    }
    return [path];
  });
}

function getWebhookUrl(token: string) {
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  return `https://${projectId}.supabase.co/functions/v1/custom-webhook/${token}`;
}

function buildTestPayload(eventType: string) {
  const base = { _test: true, timestamp: new Date().toISOString(), event_type: eventType };
  switch (eventType) {
    case "carrinho_abandonado":
      return { ...base, customer: { name: "João Teste", phone: "5511999999999", email: "joao@teste.com" }, cart: { total: 197, product: "Produto Teste" } };
    case "pix":
      return { ...base, customer: { name: "Maria Teste", phone: "5511888888888" }, payment: { method: "pix", amount: 297, status: "pending" } };
    case "cartao":
      return { ...base, customer: { name: "Pedro Teste", phone: "5511777777777" }, payment: { method: "credit_card", amount: 497, status: "pending" } };
    case "compra_aprovada":
      return { ...base, customer: { name: "Ana Teste", phone: "5511666666666" }, order: { id: "ORD-TEST-001", amount: 397, product: "Produto Premium" } };
    case "reembolso":
      return { ...base, customer: { name: "Carlos Teste", phone: "5511555555555" }, refund: { order_id: "ORD-TEST-002", amount: 197, reason: "Insatisfação" } };
    case "cancelamento":
      return { ...base, customer: { name: "Lucia Teste", phone: "5511444444444" }, cancellation: { order_id: "ORD-TEST-003", reason: "Desistência" } };
    default:
      return base;
  }
}

interface WebhookEventModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventType: string;
  endpoint: any;
}

export function WebhookEventModal({ open, onOpenChange, eventType, endpoint }: WebhookEventModalProps) {
  const meta = EVENT_META[eventType];
  const Icon = meta?.icon || Link2;
  const [copied, setCopied] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [savingMapping, setSavingMapping] = useState(false);
  const [fieldMapping, setFieldMapping] = useState<FieldMapping>({});
  const queryClient = useQueryClient();

  const webhookUrl = endpoint ? getWebhookUrl(endpoint.webhook_token) : "";

  const { data: events } = useQuery({
    queryKey: ["webhook-modal-events", eventType],
    queryFn: async () => {
      const { data } = await supabase
        .from("webhook_events")
        .select("*")
        .eq("event_type", eventType)
        .order("created_at", { ascending: false })
        .limit(20);
      return data || [];
    },
    enabled: open && !!endpoint,
    refetchInterval: open ? 5000 : false,
  });

  useEffect(() => {
    setFieldMapping(normalizeFieldMapping(endpoint?.field_mapping));
  }, [endpoint?.id, endpoint?.field_mapping]);

  const payloadPathOptions = useMemo(() => {
    const paths = new Set<string>();
    (events || []).forEach((event: any) => {
      extractPayloadPaths(event.payload).forEach((path) => paths.add(path));
    });
    return Array.from(paths).sort().slice(0, 120);
  }, [events]);

  const copyUrl = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    toast.success("URL copiada!");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTest = async () => {
    if (!endpoint) return;
    setSendingTest(true);
    try {
      const payload = buildTestPayload(eventType);
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("Teste enviado com sucesso!");
      queryClient.invalidateQueries({ queryKey: ["webhook-modal-events", eventType] });
      queryClient.invalidateQueries({ queryKey: ["webhook-events-recent"] });
    } catch (err: any) {
      toast.error(err.message || "Erro ao enviar teste");
    } finally {
      setSendingTest(false);
    }
  };

  const handleSaveMapping = async () => {
    if (!endpoint) return;
    setSavingMapping(true);
    try {
      const cleaned = normalizeFieldMapping(fieldMapping);
      const { error } = await supabase
        .from("webhook_endpoints")
        .update({ field_mapping: cleaned })
        .eq("id", endpoint.id);
      if (error) throw error;
      toast.success("Mapeamento salvo");
      queryClient.invalidateQueries({ queryKey: ["webhook-endpoints"] });
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar mapeamento");
    } finally {
      setSavingMapping(false);
    }
  };

  const fields = EXPECTED_FIELDS[eventType] || [];
  const actions = ACTIONS[eventType] || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl p-0 gap-0 overflow-hidden max-h-[90vh]">
        {/* Branding header */}
        <div className="flex items-center gap-3 px-6 pt-6 pb-3">
          <div className={cn("h-11 w-11 rounded-xl flex items-center justify-center", meta?.color)}>
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <DialogTitle className="text-base font-semibold">{meta?.label || eventType}</DialogTitle>
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
                {endpoint ? (
                  <>
                    <div className="space-y-3">
                      <h3 className="text-sm font-semibold">URL do Webhook</h3>
                      <p className="text-xs text-muted-foreground">Use esta URL para receber notificações deste evento.</p>
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
                          <span className="text-muted-foreground">Configure esta URL no painel da sua plataforma de pagamento para receber notificações em tempo real.</span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <h3 className="text-sm font-semibold">Teste de Webhook</h3>
                      <p className="text-xs text-muted-foreground">Teste se o webhook está funcionando corretamente aguardando um evento.</p>
                      <Button
                        onClick={handleTest}
                        disabled={sendingTest}
                        className="gap-2 text-sm"
                      >
                        {sendingTest ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        {sendingTest ? "Aguardando..." : "Aguardar Evento"}
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="text-center py-8 text-sm text-muted-foreground">
                    Este webhook ainda não foi ativado. Ative-o na lista para gerar a URL.
                  </div>
                )}
              </TabsContent>

              {/* Variables Tab */}
              <TabsContent value="variables" className="mt-0 space-y-4">
                {endpoint && (
                  <div className="space-y-3 rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold">Mapeamento de Parâmetros</h3>
                        <p className="text-xs text-muted-foreground">Selecione o caminho do JSON que alimenta cada variável do lead e do fluxo.</p>
                      </div>
                      <Button
                        size="sm"
                        onClick={handleSaveMapping}
                        disabled={savingMapping}
                        className="gap-2 text-xs"
                      >
                        {savingMapping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        Salvar
                      </Button>
                    </div>

                    <datalist id={`payload-paths-${eventType}`}>
                      {payloadPathOptions.map((path) => (
                        <option key={path} value={path} />
                      ))}
                    </datalist>

                    <div className="grid gap-2">
                      {FIELD_MAPPING_FIELDS.map((field) => (
                        <div key={field.key} className="grid gap-1.5 sm:grid-cols-[150px_1fr] sm:items-center">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium">{field.label}</span>
                            {field.required && <Badge variant="default" className="text-[9px] px-1">Obrigatório</Badge>}
                          </div>
                          <Input
                            value={fieldMapping[field.key] || ""}
                            list={`payload-paths-${eventType}`}
                            placeholder={field.placeholder}
                            onChange={(event) => setFieldMapping((current) => ({
                              ...current,
                              [field.key]: event.target.value,
                            }))}
                            className="h-8 font-mono text-xs"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <h3 className="text-sm font-semibold mb-1">Campos do Payload</h3>
                  <p className="text-xs text-muted-foreground mb-3">Campos esperados no JSON do webhook para este evento.</p>
                  <div className="divide-y divide-border rounded-lg border">
                    {fields.map((f) => (
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
                  <Badge variant="outline" className="text-[10px]">{events?.length || 0} registros</Badge>
                </div>
                {!events || events.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic py-6 text-center">Nenhum evento registrado ainda.</p>
                ) : (
                  <div className="space-y-2">
                    {events.map((event: any) => (
                      <div key={event.id} className="flex items-start gap-2 text-xs p-2.5 rounded-lg bg-muted/30 border">
                        <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                          {event.is_test ? (
                            <Badge variant="outline" className="text-[9px] px-1">TESTE</Badge>
                          ) : (
                            <Badge className="text-[9px] px-1 bg-primary/10 text-primary border-primary/20">REAL</Badge>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] text-muted-foreground">
                            {format(new Date(event.created_at), "dd/MM/yyyy HH:mm:ss", { locale: ptBR })}
                          </p>
                          <pre className="text-[10px] text-muted-foreground mt-1 overflow-auto whitespace-pre-wrap break-all max-h-20">
                            {JSON.stringify(event.payload, null, 2)?.substring(0, 300)}
                          </pre>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* Actions Tab */}
              <TabsContent value="actions" className="mt-0 space-y-3">
                <h3 className="text-sm font-semibold">Ações Automáticas</h3>
                <p className="text-xs text-muted-foreground">Ações executadas automaticamente quando este webhook é recebido.</p>
                <div className="divide-y divide-border rounded-lg border">
                  {actions.map((a) => (
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
