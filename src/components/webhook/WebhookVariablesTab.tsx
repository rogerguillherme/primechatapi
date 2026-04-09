import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Shield } from "lucide-react";

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

const EVENT_TYPES = [
  { event: "Compra aprovada", status: "approved", description: "Cria pedido + lead + itens automaticamente" },
  { event: "Pagamento confirmado", status: "paid", description: "Atualiza status para pago" },
  { event: "Reembolso", status: "refunded", description: "Atualiza status para reembolsado" },
  { event: "Chargeback", status: "chargeback", description: "Atualiza status para chargeback" },
  { event: "Cancelamento", status: "cancelled", description: "Atualiza status para cancelado" },
  { event: "Carrinho abandonado", status: "carrinho_abandonado", description: "Lead adicionou ao carrinho mas não finalizou" },
  { event: "Cartão recusado", status: "cartao_recusado", description: "Tentativa de pagamento com cartão falhou" },
  { event: "PIX não pago", status: "pix_nao_pago", description: "PIX gerado mas não pago dentro do prazo" },
];

export function WebhookVariablesTab() {
  return (
    <div className="space-y-6">
      {/* Eventos Suportados */}
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

      {/* Campos do Payload */}
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
                  <p className="text-xs font-mono">{f.field}</p>
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
    </div>
  );
}
