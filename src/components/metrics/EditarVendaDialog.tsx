import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Pencil, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const STATUS_OPCOES = [
  { value: "approved", label: "Confirmada" },
  { value: "pending", label: "Pendente" },
  { value: "refunded", label: "Reembolsada" },
  { value: "chargeback", label: "Chargeback" },
  { value: "cancelled", label: "Cancelada" },
];

type Venda = {
  id: string;
  amount: number;
  status: string;
  created_at: string;
  lead_id: string | null;
  assignedTo: string | null;
};

type Membro = { member_user_id: string; display_name: string | null; email: string | null };

const SEM_VENDEDOR = "__sem_vendedor__";

/**
 * Correção manual de uma venda já lançada — valor digitado errado na
 * importação, status que ficou pendente e o pagamento caiu, data errada. O
 * vendedor É o atendente responsável pelo lead no CRM (não um campo próprio
 * da venda) — trocar aqui é o mesmo dado, só editado de um lugar mais rápido
 * que abrir o lead no chat.
 */
export function EditarVendaDialog({ venda, membros }: { venda: Venda; membros: Membro[] }) {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [valor, setValor] = useState(() => (Number(venda.amount) || 0).toFixed(2).replace(".", ","));
  const [status, setStatus] = useState(venda.status);
  const [data, setData] = useState(() => format(new Date(venda.created_at), "yyyy-MM-dd"));
  const [vendedorId, setVendedorId] = useState(venda.assignedTo || SEM_VENDEDOR);

  const salvar = useMutation({
    mutationFn: async () => {
      const v = Number(valor.replace(/\./g, "").replace(",", "."));
      if (!Number.isFinite(v) || v <= 0) throw new Error("Informe um valor maior que zero.");

      // Preserva o horário original, só troca o dia — evita que a venda
      // "pule" de posição na ordenação por causa da hora virar meio-dia.
      const original = new Date(venda.created_at);
      const novaData = new Date(data + "T12:00:00");
      novaData.setHours(original.getHours(), original.getMinutes(), original.getSeconds());

      const { error } = await (supabase as any)
        .from("orders")
        .update({ amount: v, status, created_at: novaData.toISOString() })
        .eq("id", venda.id);
      if (error) throw error;

      const novoVendedor = vendedorId === SEM_VENDEDOR ? null : vendedorId;
      if (venda.lead_id && novoVendedor !== (venda.assignedTo || null)) {
        const { error: leadError } = await (supabase as any)
          .from("leads")
          .update({ assigned_to: novoVendedor })
          .eq("id", venda.lead_id);
        if (leadError) throw leadError;
      }
    },
    onSuccess: () => {
      toast.success("Venda atualizada.");
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
        <button
          className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Editar venda"
        >
          <Pencil size={14} />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Editar venda</DialogTitle>
          <DialogDescription>
            Ajusta valor, status, data e o vendedor responsável. Cliente não muda aqui.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="valor-edit">Valor</Label>
              <Input
                id="valor-edit"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder="497,00"
                className="h-9 tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="data-edit">Data</Label>
              <Input
                id="data-edit"
                type="date"
                value={data}
                onChange={(e) => setData(e.target.value)}
                className="h-9"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPCOES.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Vendedor</Label>
            {venda.lead_id ? (
              <Select value={vendedorId} onValueChange={setVendedorId}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEM_VENDEDOR}>Sem vendedor</SelectItem>
                  {membros.map((m) => (
                    <SelectItem key={m.member_user_id} value={m.member_user_id}>
                      {m.display_name || m.email || "Vendedor"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Essa venda não tem cliente vinculado — sem lead não há a quem atribuir.
              </p>
            )}
          </div>

          <Button className="w-full gap-2" disabled={salvar.isPending} onClick={() => salvar.mutate()}>
            {salvar.isPending && <Loader2 size={14} className="animate-spin" />}
            Salvar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
