import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Plus, Loader2 } from "lucide-react";
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

/**
 * Lançamento manual de venda.
 *
 * Nem toda venda chega por webhook: PIX na mão, cobrança fora do checkout,
 * acerto que entrou por outro caminho. Sem uma porta para isso, o operador
 * ajusta a conta numa planilha paralela — e a partir daí o painel deixa de ser
 * a fonte da verdade, que é a única coisa que ele precisa ser.
 *
 * A venda entra em `orders` como qualquer outra, com plataforma "manual" para
 * ficar distinguível depois. Ela precisa de um lead porque é dele que sai o
 * vendedor: sem isso a venda nasceria sem dono e fora de qualquer comissão.
 */
export function NovaVendaDialog({ ownerId }: { ownerId: string | null }) {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [leadId, setLeadId] = useState("");
  const [valor, setValor] = useState("");
  const [data, setData] = useState(format(new Date(), "yyyy-MM-dd"));

  const { data: leads = [] } = useQuery({
    queryKey: ["nova-venda-leads", busca],
    enabled: aberto,
    queryFn: async () => {
      let q = (supabase as any)
        .from("leads")
        .select("id, name, phone, assigned_to")
        .order("updated_at", { ascending: false })
        .limit(30);
      const termo = busca.trim();
      if (termo) q = q.or(`name.ilike.%${termo}%,phone.ilike.%${termo}%`);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });

  const escolhido = (leads as any[]).find((l) => l.id === leadId);

  const lancar = useMutation({
    mutationFn: async () => {
      const v = Number(valor.replace(/\./g, "").replace(",", "."));
      if (!leadId) throw new Error("Escolha o cliente — é dele que sai o vendedor.");
      if (!Number.isFinite(v) || v <= 0) throw new Error("Informe um valor maior que zero.");

      const { error } = await (supabase as any).from("orders").insert({
        lead_id: leadId,
        amount: v,
        status: "approved",
        payment_method: "manual",
        platform: "manual",
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
      setValor("");
      setLeadId("");
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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Lançar venda manual</DialogTitle>
          <DialogDescription>
            Para o que não veio por webhook — PIX na mão, cobrança fora do checkout.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Cliente</Label>
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome ou telefone…"
              className="h-9"
            />
            <Select value={leadId} onValueChange={setLeadId}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Escolha o cliente" />
              </SelectTrigger>
              <SelectContent>
                {(leads as any[]).map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name || "Sem nome"} {l.phone ? `· ${l.phone}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {escolhido && !escolhido.assigned_to && (
              // Avisar ANTES de lançar: descobrir depois que a venda não
              // entrou em comissão nenhuma custa uma investigação.
              <p className="text-[11px] text-amber-500">
                Este cliente não tem atendente responsável — a venda vai contar no
                faturamento, mas fora da comissão. Atribua no chat antes de fechar o ciclo.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="valor">Valor</Label>
              <Input
                id="valor"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder="497,00"
                className="h-9 tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="data">Data</Label>
              <Input
                id="data"
                type="date"
                value={data}
                onChange={(e) => setData(e.target.value)}
                className="h-9"
              />
            </div>
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
