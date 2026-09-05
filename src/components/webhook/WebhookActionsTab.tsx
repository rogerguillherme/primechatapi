import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Zap } from "lucide-react";

const ACTIONS = [
  { action: "Criar Lead", description: "Cria automaticamente um lead com nome, telefone e email do comprador", trigger: "Compra aprovada" },
  { action: "Criar Pedido", description: "Registra o pedido com valor, produto e forma de pagamento", trigger: "Compra aprovada" },
  { action: "Resolver Itens", description: "Identifica o produto pela composição e vincula os itens ao pedido", trigger: "Compra aprovada" },
  { action: "Atualizar Status", description: "Atualiza o status do pedido para reembolsado, chargeback ou cancelado", trigger: "Reembolso / Chargeback / Cancelamento" },
  { action: "Disparar Fluxo", description: "Inicia automaticamente um fluxo de automação vinculado ao evento", trigger: "Qualquer evento com fluxo ativo" },
  { action: "Criar Notificação", description: "Gera uma notificação no sistema sobre o evento recebido", trigger: "Todos os eventos" },
];

export function WebhookActionsTab() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-primary" />
          <CardTitle className="text-base">Ações Automáticas</CardTitle>
        </div>
        <CardDescription>Ações executadas automaticamente quando um webhook é recebido.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="divide-y divide-border">
          {ACTIONS.map((a) => (
            <div key={a.action} className="flex items-start justify-between py-3 first:pt-0 last:pb-0 gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">{a.action}</p>
                <p className="text-xs text-muted-foreground">{a.description}</p>
              </div>
              <Badge variant="outline" className="shrink-0 text-xs whitespace-nowrap">{a.trigger}</Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
