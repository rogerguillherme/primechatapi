import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { moeda } from "@/components/metrics/ui";

export type VendaSemVendedor = {
  id: string;
  amount: number;
  created_at: string;
  lead_id: string | null;
  leadNome: string | null;
  leadEmail: string | null;
};

type Membro = { member_user_id: string; display_name: string | null; email: string | null };

/**
 * Atribuir vendedor pra várias vendas "sem atribuição" de uma vez — a mesma
 * ação do editar-venda individual (grava em `leads.assigned_to`), só que em
 * lote. Só entram vendas que já têm cliente (lead_id) vinculado: sem isso não
 * existe onde gravar o vendedor, e essas precisam ser tratadas uma a uma
 * (botão de editar), como já é hoje.
 */
export function AtribuirVendedorLoteDialog({
  open, onOpenChange, vendas, membros,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  vendas: VendaSemVendedor[];
  membros: Membro[];
}) {
  const qc = useQueryClient();
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [vendedorId, setVendedorId] = useState("");

  const comLead = vendas.filter((v) => v.lead_id);
  const semLead = vendas.length - comLead.length;

  const toggle = (id: string) => {
    setSelecionadas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const alternarTodas = () => {
    setSelecionadas((prev) => (prev.size === comLead.length ? new Set() : new Set(comLead.map((v) => v.id))));
  };

  const atribuir = useMutation({
    mutationFn: async () => {
      if (!vendedorId) throw new Error("Escolha um vendedor.");
      const leadIds = Array.from(
        new Set(comLead.filter((v) => selecionadas.has(v.id)).map((v) => v.lead_id as string)),
      );
      if (leadIds.length === 0) throw new Error("Selecione ao menos uma venda.");
      const { error } = await supabase.from("leads").update({ assigned_to: vendedorId }).in("id", leadIds);
      if (error) throw error;
      return leadIds.length;
    },
    onSuccess: (n) => {
      toast.success(`${n} cliente(s) atribuído(s) ao vendedor.`);
      qc.invalidateQueries({ queryKey: ["metrik-vendas"] });
      qc.invalidateQueries({ queryKey: ["metrik-orders"] });
      qc.invalidateQueries({ queryKey: ["metrik-historico"] });
      setSelecionadas(new Set());
      setVendedorId("");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message || "Erro ao atribuir"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Atribuir vendedor em lote</DialogTitle>
          <DialogDescription>
            Escolha o vendedor e marque as vendas que são dele. Isso atribui o cliente a esse
            vendedor no CRM — o mesmo que editar o lead no chat, só que pra várias de uma vez.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Select value={vendedorId} onValueChange={setVendedorId}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Selecione o vendedor" />
            </SelectTrigger>
            <SelectContent>
              {membros.map((m) => (
                <SelectItem key={m.member_user_id} value={m.member_user_id}>
                  {m.display_name || m.email || "Vendedor"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {comLead.length > 0 && (
            <button type="button" onClick={alternarTodas} className="text-xs text-primary hover:underline">
              {selecionadas.size === comLead.length ? "Desmarcar todas" : `Selecionar todas (${comLead.length})`}
            </button>
          )}

          <div className="max-h-72 overflow-y-auto rounded-lg border divide-y">
            {comLead.map((v) => (
              <label key={v.id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-muted/50">
                <input
                  type="checkbox"
                  checked={selecionadas.has(v.id)}
                  onChange={() => toggle(v.id)}
                  className="h-4 w-4 rounded border-input"
                />
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{v.leadNome || v.leadEmail || "Cliente sem nome"}</p>
                  <p className="text-xs text-muted-foreground">{format(new Date(v.created_at), "dd/MM HH:mm")}</p>
                </div>
                <span className="font-semibold tabular-nums">{moeda(Number(v.amount) || 0)}</span>
              </label>
            ))}
            {comLead.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                Nenhuma venda sem vendedor tem cliente vinculado pra atribuir em lote.
              </p>
            )}
          </div>

          {semLead > 0 && (
            <p className="text-xs text-muted-foreground">
              {semLead} venda(s) sem vendedor também não têm cliente vinculado — edite cada uma
              individualmente (botão de editar na tabela) pra vincular o telefone primeiro.
            </p>
          )}

          <Button
            className="w-full gap-2"
            disabled={atribuir.isPending || !vendedorId || selecionadas.size === 0}
            onClick={() => atribuir.mutate()}
          >
            {atribuir.isPending && <Loader2 size={14} className="animate-spin" />}
            Atribuir{selecionadas.size > 0 ? ` (${selecionadas.size})` : ""}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
