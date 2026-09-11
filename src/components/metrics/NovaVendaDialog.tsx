import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Plus, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { normalizePhoneBR, parseAmountBR } from "@/lib/salesImport";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const METODO_OPCOES = [
  { value: "pix", label: "PIX" },
  { value: "cartao", label: "Cartão" },
  { value: "boleto", label: "Boleto" },
];

const RUBRICA = "text-[10px] uppercase tracking-wider text-muted-foreground";

type Membro = { member_user_id: string; display_name: string | null; email: string | null };

/**
 * Lançamento manual de venda.
 *
 * Nem toda venda chega por webhook: PIX na mão, cobrança fora do checkout,
 * acerto que entrou por outro caminho. Sem uma porta para isso, o operador
 * ajusta a conta numa planilha paralela — e a partir daí o painel deixa de ser
 * a fonte da verdade, que é a única coisa que ele precisa ser.
 *
 * O cliente entra por telefone, igual à importação de planilha: mesmo
 * telefone normalizado reaproveita o lead existente em vez de duplicar o
 * comprador. Sem telefone (comum em venda de cartão sem WhatsApp), usa um
 * telefone-placeholder só para satisfazer a coluna obrigatória.
 *
 * A venda entra em `orders` como qualquer outra, com plataforma "manual" por
 * padrão para ficar distinguível depois.
 */
export function NovaVendaDialog({ ownerId, membros }: { ownerId: string | null; membros: Membro[] }) {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);

  const [clienteNome, setClienteNome] = useState("");
  const [clienteEmail, setClienteEmail] = useState("");
  const [clienteTelefone, setClienteTelefone] = useState("");
  const [produtoNome, setProdutoNome] = useState("");
  const [valorBruto, setValorBruto] = useState("");
  const [desconto, setDesconto] = useState("");
  const [plataforma, setPlataforma] = useState("");
  const [metodoPagamento, setMetodoPagamento] = useState("pix");
  const [vendedorId, setVendedorId] = useState("");
  const [data, setData] = useState(format(new Date(), "yyyy-MM-dd"));

  const limpar = () => {
    setClienteNome("");
    setClienteEmail("");
    setClienteTelefone("");
    setProdutoNome("");
    setValorBruto("");
    setDesconto("");
    setPlataforma("");
    setMetodoPagamento("pix");
    setVendedorId("");
    setData(format(new Date(), "yyyy-MM-dd"));
  };

  const lancar = useMutation({
    mutationFn: async () => {
      const nome = clienteNome.trim();
      if (!nome) throw new Error("Informe o nome do cliente.");

      const bruto = parseAmountBR(valorBruto);
      if (!bruto || bruto <= 0) throw new Error("Informe um valor bruto maior que zero.");
      const descontoValor = parseAmountBR(desconto) || 0;

      const telefone = clienteTelefone.trim()
        ? normalizePhoneBR(clienteTelefone)
        : `sem-telefone-${crypto.randomUUID().slice(0, 8)}`;

      // Reaproveita o lead pelo telefone — mesma regra da importação de
      // planilha, para o mesmo comprador não virar dois cadastros.
      let leadId: string;
      const { data: existente } = await (supabase as any)
        .from("leads")
        .select("id, assigned_to")
        .eq("phone", telefone)
        .eq("user_id", ownerId)
        .maybeSingle();

      if (existente) {
        leadId = existente.id;
        if (vendedorId && vendedorId !== existente.assigned_to) {
          await (supabase as any).from("leads").update({ assigned_to: vendedorId }).eq("id", leadId);
        }
      } else {
        const { data: novoLead, error: leadError } = await (supabase as any)
          .from("leads")
          .insert({
            user_id: ownerId,
            name: nome,
            phone: telefone,
            email: clienteEmail.trim() || null,
            assigned_to: vendedorId || null,
            origin: "manual",
          })
          .select("id")
          .single();
        if (leadError) throw leadError;
        leadId = novoLead.id;
      }

      // Produto só quando já cadastrado pelo nome de checkout — sem match a
      // venda entra sem produto, melhor que inventar cadastro na hora.
      let productId: string | null = null;
      const produto = produtoNome.trim();
      if (produto) {
        const { data: match } = await (supabase as any)
          .from("products")
          .select("id")
          .ilike("checkout_name", produto)
          .maybeSingle();
        productId = match?.id ?? null;
      }

      const { error } = await (supabase as any).from("orders").insert({
        lead_id: leadId,
        product_id: productId,
        amount: bruto,
        net_amount: bruto - descontoValor,
        status: "approved",
        payment_method: metodoPagamento,
        platform: plataforma.trim() || "manual",
        // O id externo é obrigatório e único. Prefixo próprio para a venda
        // manual nunca colidir com a de um checkout.
        external_order_id: `manual-${crypto.randomUUID()}`,
        created_at: new Date(data + "T12:00:00").toISOString(),
        user_id: ownerId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Venda lançada.");
      limpar();
      setAberto(false);
      qc.invalidateQueries({ queryKey: ["metrik-vendas"] });
      qc.invalidateQueries({ queryKey: ["metrik-orders"] });
      qc.invalidateQueries({ queryKey: ["metrik-historico"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus size={15} /> Lançar venda
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Adicionar Venda Manualmente</DialogTitle>
          <DialogDescription>
            Para o que não veio por webhook — PIX na mão, cobrança fora do checkout.
          </DialogDescription>
        </DialogHeader>

        <Alert variant="destructive">
          <TriangleAlert className="h-4 w-4" />
          <AlertDescription>
            Essa venda entra direto no faturamento, sem passar por nenhuma validação de
            pagamento. Confira se os dados estão corretos antes de prosseguir.
          </AlertDescription>
        </Alert>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cliente-nome" className={RUBRICA}>Nome do cliente *</Label>
            <Input
              id="cliente-nome"
              value={clienteNome}
              onChange={(e) => setClienteNome(e.target.value)}
              className="h-9"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cliente-email" className={RUBRICA}>E-mail do cliente</Label>
              <Input
                id="cliente-email"
                type="email"
                value={clienteEmail}
                onChange={(e) => setClienteEmail(e.target.value)}
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cliente-telefone" className={RUBRICA}>Telefone do cliente</Label>
              <Input
                id="cliente-telefone"
                value={clienteTelefone}
                onChange={(e) => setClienteTelefone(e.target.value)}
                placeholder="(11) 91234-5678"
                className="h-9"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="produto-nome" className={RUBRICA}>Nome do produto</Label>
            <Input
              id="produto-nome"
              value={produtoNome}
              onChange={(e) => setProdutoNome(e.target.value)}
              className="h-9"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="valor-bruto" className={RUBRICA}>Valor bruto (R$) *</Label>
              <Input
                id="valor-bruto"
                value={valorBruto}
                onChange={(e) => setValorBruto(e.target.value)}
                placeholder="0.00"
                className="h-9 tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="desconto" className={RUBRICA}>Desconto plataforma (R$)</Label>
              <Input
                id="desconto"
                value={desconto}
                onChange={(e) => setDesconto(e.target.value)}
                placeholder="0.00"
                className="h-9 tabular-nums"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="plataforma" className={RUBRICA}>Plataforma</Label>
              <Input
                id="plataforma"
                value={plataforma}
                onChange={(e) => setPlataforma(e.target.value)}
                placeholder="Opcional"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className={RUBRICA}>Método de pagamento</Label>
              <Select value={metodoPagamento} onValueChange={setMetodoPagamento}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METODO_OPCOES.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className={RUBRICA}>Vendedor</Label>
            <Select value={vendedorId} onValueChange={setVendedorId}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Selecione um vendedor (Opcional)" />
              </SelectTrigger>
              <SelectContent>
                {membros.map((m) => (
                  <SelectItem key={m.member_user_id} value={m.member_user_id}>
                    {m.display_name || m.email || "Vendedor"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="data" className={RUBRICA}>Data</Label>
            <Input
              id="data"
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
              className="h-9"
            />
          </div>

          <Button
            className="w-full gap-2"
            disabled={lancar.isPending}
            onClick={() => lancar.mutate()}
          >
            {lancar.isPending && <Loader2 size={14} className="animate-spin" />}
            Lançar venda
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
