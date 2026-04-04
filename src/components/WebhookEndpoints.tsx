import { useState } from "react";
import { GitBranch } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Webhook, Copy, CheckCircle2, Loader2, Send, Trash2, Eye, EyeOff,
  ShoppingCart, CreditCard, QrCode, PackageCheck, RotateCcw, XCircle, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const EVENT_TYPES = [
  { value: "carrinho_abandonado", label: "Carrinho Abandonado", icon: ShoppingCart, color: "text-amber-500" },
  { value: "pix", label: "Pix", icon: QrCode, color: "text-emerald-500" },
  { value: "cartao", label: "Cartão", icon: CreditCard, color: "text-blue-500" },
  { value: "compra_aprovada", label: "Compra Aprovada", icon: PackageCheck, color: "text-green-500" },
  { value: "reembolso", label: "Reembolso", icon: RotateCcw, color: "text-orange-500" },
  { value: "cancelamento", label: "Cancelamento", icon: XCircle, color: "text-red-500" },
] as const;

function getWebhookUrl(token: string) {
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  return `https://${projectId}.supabase.co/functions/v1/custom-webhook/${token}`;
}

export function WebhookEndpoints({ onCreateFlow }: { onCreateFlow?: (triggerType: string) => void }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [sendingTest, setSendingTest] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);

  const { data: endpoints, isLoading } = useQuery({
    queryKey: ["webhook-endpoints"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("webhook_endpoints")
        .select("*")
        .order("created_at");
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  const { data: recentEvents } = useQuery({
    queryKey: ["webhook-events-recent"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("webhook_events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  const handleCreateEndpoint = async (eventType: string) => {
    if (!user) return;
    try {
      const { error } = await supabase.from("webhook_endpoints").insert({
        user_id: user.id,
        event_type: eventType,
      });
      if (error) throw error;
      toast.success("Webhook criado com sucesso!");
      queryClient.invalidateQueries({ queryKey: ["webhook-endpoints"] });
    } catch (err: any) {
      toast.error(err.message || "Erro ao criar webhook");
    }
  };

  const handleToggle = async (id: string, isActive: boolean) => {
    const { error } = await supabase
      .from("webhook_endpoints")
      .update({ is_active: !isActive })
      .eq("id", id);
    if (error) {
      toast.error("Erro ao atualizar webhook");
    } else {
      queryClient.invalidateQueries({ queryKey: ["webhook-endpoints"] });
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase
      .from("webhook_endpoints")
      .delete()
      .eq("id", id);
    if (error) {
      toast.error("Erro ao remover webhook");
    } else {
      toast.success("Webhook removido");
      queryClient.invalidateQueries({ queryKey: ["webhook-endpoints"] });
      queryClient.invalidateQueries({ queryKey: ["webhook-events-recent"] });
    }
  };

  const handleCopy = (token: string) => {
    navigator.clipboard.writeText(getWebhookUrl(token));
    setCopiedToken(token);
    toast.success("URL copiada!");
    setTimeout(() => setCopiedToken(null), 2000);
  };

  const handleSendTest = async (endpoint: any) => {
    setSendingTest(endpoint.id);
    try {
      const testPayload = buildTestPayload(endpoint.event_type);
      const url = getWebhookUrl(endpoint.webhook_token);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(testPayload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha no teste");
      toast.success("Teste enviado e registrado com sucesso!");
      queryClient.invalidateQueries({ queryKey: ["webhook-events-recent"] });
    } catch (err: any) {
      toast.error(err.message || "Erro ao enviar teste");
    } finally {
      setSendingTest(null);
    }
  };

  const getEndpoint = (eventType: string) =>
    endpoints?.find((e: any) => e.event_type === eventType);

  const getEventsForType = (eventType: string) =>
    recentEvents?.filter((e: any) => e.event_type === eventType) || [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Webhook size={20} />
            Webhooks de Eventos
          </CardTitle>
          <CardDescription>
            Configure webhooks para receber eventos de plataformas externas (checkout, pagamento, etc.).
            Copie a URL e cole na sua plataforma de pagamento. Depois, use esses eventos como gatilho nos seus fluxos.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {EVENT_TYPES.map((evt) => {
            const endpoint = getEndpoint(evt.value);
            const events = getEventsForType(evt.value);
            const isExpanded = expandedEvent === evt.value;
            const Icon = evt.icon;

            return (
              <div key={evt.value} className="border rounded-lg overflow-hidden">
                {/* Header row */}
                <div className="flex items-center gap-3 p-4">
                  <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center bg-muted", evt.color)}>
                    <Icon size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{evt.label}</span>
                      {endpoint && (
                        <Badge
                          variant={endpoint.is_active ? "default" : "secondary"}
                          className={cn("text-[10px]", endpoint.is_active && "bg-green-500/10 text-green-600 border-green-500/20")}
                        >
                          {endpoint.is_active ? "Ativo" : "Inativo"}
                        </Badge>
                      )}
                      {events.length > 0 && (
                        <Badge variant="outline" className="text-[10px]">
                          {events.length} evento{events.length !== 1 ? "s" : ""}
                        </Badge>
                      )}
                    </div>
                    {endpoint && (
                      <div className="flex items-center gap-1 mt-1">
                        <code className="text-[10px] text-muted-foreground truncate max-w-[300px]">
                          {getWebhookUrl(endpoint.webhook_token)}
                        </code>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5"
                          onClick={() => handleCopy(endpoint.webhook_token)}
                        >
                          {copiedToken === endpoint.webhook_token ? (
                            <CheckCircle2 size={10} className="text-green-500" />
                          ) : (
                            <Copy size={10} />
                          )}
                        </Button>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {endpoint ? (
                      <>
                        <Switch
                          checked={endpoint.is_active}
                          onCheckedChange={() => handleToggle(endpoint.id, endpoint.is_active)}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleSendTest(endpoint)}
                          disabled={sendingTest === endpoint.id}
                          className="gap-1 text-xs"
                        >
                          {sendingTest === endpoint.id ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Send size={12} />
                          )}
                          Teste
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setExpandedEvent(isExpanded ? null : evt.value)}
                        >
                          {isExpanded ? <EyeOff size={14} /> : <Eye size={14} />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => handleDelete(endpoint.id)}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleCreateEndpoint(evt.value)}
                        className="gap-1 text-xs"
                      >
                        <Webhook size={12} />
                        Ativar
                      </Button>
                    )}
                  </div>
                </div>

                {/* Expanded events log */}
                {isExpanded && endpoint && (
                  <div className="border-t bg-muted/20 p-3">
                    <p className="text-xs font-medium text-muted-foreground mb-2">Últimos eventos recebidos:</p>
                    {events.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic">Nenhum evento registrado ainda. Envie um teste ou aguarde eventos da plataforma.</p>
                    ) : (
                      <ScrollArea className="max-h-[200px]">
                        <div className="space-y-2">
                          {events.slice(0, 10).map((event: any) => (
                            <div key={event.id} className="flex items-start gap-2 text-xs p-2 rounded bg-background border">
                              <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
                                {event.is_test ? (
                                  <Badge variant="outline" className="text-[9px] px-1">TESTE</Badge>
                                ) : (
                                  <Badge variant="default" className="text-[9px] px-1 bg-primary/10 text-primary">REAL</Badge>
                                )}
                                <Clock size={10} className="text-muted-foreground" />
                                <span className="text-muted-foreground">
                                  {format(new Date(event.created_at), "dd/MM HH:mm", { locale: ptBR })}
                                </span>
                              </div>
                              <pre className="text-[10px] text-muted-foreground overflow-auto flex-1">
                                {JSON.stringify(event.payload, null, 2).substring(0, 200)}
                              </pre>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

function buildTestPayload(eventType: string) {
  const base = {
    _test: true,
    timestamp: new Date().toISOString(),
    event_type: eventType,
  };

  switch (eventType) {
    case "carrinho_abandonado":
      return { ...base, customer: { name: "João Teste", phone: "5511999999999", email: "joao@teste.com" }, cart: { total: 197.00, product: "Produto Teste" } };
    case "pix":
      return { ...base, customer: { name: "Maria Teste", phone: "5511888888888" }, payment: { method: "pix", amount: 297.00, status: "pending" } };
    case "cartao":
      return { ...base, customer: { name: "Pedro Teste", phone: "5511777777777" }, payment: { method: "credit_card", amount: 497.00, status: "pending" } };
    case "compra_aprovada":
      return { ...base, customer: { name: "Ana Teste", phone: "5511666666666" }, order: { id: "ORD-TEST-001", amount: 397.00, product: "Produto Premium" } };
    case "reembolso":
      return { ...base, customer: { name: "Carlos Teste", phone: "5511555555555" }, refund: { order_id: "ORD-TEST-002", amount: 197.00, reason: "Insatisfação" } };
    case "cancelamento":
      return { ...base, customer: { name: "Lucia Teste", phone: "5511444444444" }, cancellation: { order_id: "ORD-TEST-003", reason: "Desistência" } };
    default:
      return base;
  }
}
