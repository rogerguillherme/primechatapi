import { lazy, Suspense, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { DollarSign, Clock, RotateCcw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useMetrikData } from "@/hooks/use-metrik-data";
import { useMetrikPeriodo } from "@/hooks/use-metrik-periodo";
import { SeletorPeriodo } from "@/components/metrics/SeletorPeriodo";
import { useFavicon } from "@/hooks/use-favicon";
import { Input } from "@/components/ui/input";
import { Card, Kpi, TituloPagina, Vazio, moeda } from "@/components/metrics/ui";
import { NovaVendaDialog } from "@/components/metrics/NovaVendaDialog";
import { EditarVendaDialog } from "@/components/metrics/EditarVendaDialog";
import { AtribuirVendedorLoteDialog, type VendaSemVendedor } from "@/components/metrics/AtribuirVendedorLoteDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Upload } from "lucide-react";

// A importação já existe pronta no Prime Chat: lê a planilha, mapeia colunas,
// evita duplicata por external_order_id, cria o lead e grava em `orders`.
// Reescrever aqui daria dois importadores divergindo na primeira correção.
const SalesImporter = lazy(() =>
  import("@/components/sales/SalesImporter").then((m) => ({ default: m.SalesImporter })),
);
import { cn } from "@/lib/utils";

const ROTULO: Record<string, { texto: string; classe: string }> = {
  approved: { texto: "Confirmada", classe: "bg-primary/15 text-primary" },
  pending: { texto: "Pendente", classe: "bg-amber-500/15 text-amber-500" },
  refunded: { texto: "Reembolsada", classe: "bg-destructive/15 text-destructive" },
  chargeback: { texto: "Chargeback", classe: "bg-destructive/15 text-destructive" },
  cancelled: { texto: "Cancelada", classe: "bg-muted text-muted-foreground" },
};

function ExcluirVendaButton({ vendaId }: { vendaId: string }) {
  const qc = useQueryClient();
  const excluir = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("orders").delete().eq("id", vendaId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Venda excluída.");
      qc.invalidateQueries({ queryKey: ["metrik-vendas"] });
      qc.invalidateQueries({ queryKey: ["metrik-orders"] });
      qc.invalidateQueries({ queryKey: ["metrik-historico"] });
    },
    onError: (e: Error) => toast.error(e.message || "Erro ao excluir venda"),
  });

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button
          className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          title="Excluir venda"
        >
          <Trash2 size={14} />
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir venda?</AlertDialogTitle>
          <AlertDialogDescription>
            Essa ação remove a venda permanentemente e afeta faturamento e comissões já
            calculados. Não pode ser desfeita.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => excluir.mutate()}
            className="gap-2 bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Excluir
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function MetrikVendas() {
  useFavicon("/metrik-favicon.svg");

  const { inicio, fim } = useMetrikPeriodo();
  const { membros, ownerId, podeConfigurar } = useMetrikData(inicio, fim);

  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState<string>("todos");
  const [loteAberto, setLoteAberto] = useState(false);

  // Independente do período selecionado: venda pendente parada é o sintoma
  // clássico de webhook que falhou em silêncio, e some da vista se ninguém
  // olhar fora do período atual. Só ApplyFy tem reconferência automática por
  // API — nas outras 12 plataformas isso precisa aparecer pra alguém notar.
  const { data: pendentesAntigas = 0 } = useQuery({
    queryKey: ["metrik-pendentes-antigas"],
    queryFn: async () => {
      const limite = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const { count, error } = await (supabase as any)
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .lt("created_at", limite);
      if (error) throw error;
      return count || 0;
    },
  });

  const { data: vendas = [], isLoading } = useQuery({
    queryKey: ["metrik-vendas", inicio.toISOString()],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("orders")
        .select("id, amount, status, created_at, payment_method, lead_id, leads(name, email, assigned_to)")
        .gte("created_at", inicio.toISOString())
        .lte("created_at", fim.toISOString())
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return data || [];
    },
  });

  const nomePor = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of membros) m.set(x.member_user_id, x.display_name || x.email || "Vendedor");
    return m;
  }, [membros]);

  const totais = useMemo(() => {
    let confirmado = 0, pendente = 0, reembolsado = 0;
    let qtdConfirmada = 0, qtdPendente = 0, qtdReembolso = 0, naoAtribuidas = 0;
    for (const v of vendas as any[]) {
      const valor = Number(v.amount) || 0;
      if (v.status === "approved") {
        confirmado += valor;
        qtdConfirmada += 1;
        // "Não atribuída" é venda que entrou e não tem dono: não some do
        // faturamento, mas não entra em comissão de ninguém.
        if (!v.leads?.assigned_to) naoAtribuidas += 1;
      } else if (v.status === "pending") {
        pendente += valor;
        qtdPendente += 1;
      } else if (v.status === "refunded" || v.status === "chargeback") {
        reembolsado += valor;
        qtdReembolso += 1;
      }
    }
    return { confirmado, pendente, reembolsado, qtdConfirmada, qtdPendente, qtdReembolso, naoAtribuidas };
  }, [vendas]);

  const vendasSemVendedor: VendaSemVendedor[] = useMemo(() => {
    return (vendas as any[])
      .filter((v) => v.status === "approved" && !v.leads?.assigned_to)
      .map((v) => ({
        id: v.id,
        amount: v.amount,
        created_at: v.created_at,
        lead_id: v.lead_id,
        leadNome: v.leads?.name ?? null,
        leadEmail: v.leads?.email ?? null,
      }));
  }, [vendas]);

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (vendas as any[]).filter((v) => {
      if (status !== "todos" && v.status !== status) return false;
      if (!termo) return true;
      return (
        (v.leads?.name || "").toLowerCase().includes(termo) ||
        (v.leads?.email || "").toLowerCase().includes(termo)
      );
    });
  }, [vendas, busca, status]);

  return (
    <div className="space-y-6">
      <TituloPagina
        titulo="Vendas"
        sub={`${format(inicio, "dd 'de' MMMM", { locale: ptBR })} a ${format(fim, "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}`}
        acao={
          podeConfigurar ? (
            <div className="flex gap-2">
              <Dialog>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline" className="gap-1.5">
                    <Upload size={15} /> Importar planilha
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Importar planilha de vendas</DialogTitle>
                    <DialogDescription>
                      CSV da plataforma. Vendas já existentes são ignoradas pelo número do
                      pedido, então reimportar o mesmo arquivo não duplica nada.
                    </DialogDescription>
                  </DialogHeader>
                  <Suspense fallback={<p className="text-sm text-muted-foreground">Carregando…</p>}>
                    <SalesImporter />
                  </Suspense>
                </DialogContent>
              </Dialog>
              <NovaVendaDialog ownerId={ownerId} membros={membros} />
            </div>
          ) : undefined
        }
      />

      <SeletorPeriodo />

      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi rotulo="Valor confirmado" valor={moeda(totais.confirmado)} nota={`${totais.qtdConfirmada} venda(s)`} icone={DollarSign} destaque />
        <Kpi rotulo="Pendente a pagar" valor={moeda(totais.pendente)} nota={`${totais.qtdPendente} pendente(s)`} icone={Clock} />
        <Kpi
          rotulo="Reembolsado"
          valor={moeda(totais.reembolsado)}
          nota={`${totais.qtdReembolso} devolução(ões)`}
          icone={RotateCcw}
          tom={totais.reembolsado > 0 ? "text-destructive" : undefined}
        />
      </div>

      {totais.naoAtribuidas > 0 && (
        <Card className="border-amber-500/40">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              <b className="text-amber-500">{totais.naoAtribuidas} venda(s) sem vendedor.</b>{" "}
              <span className="text-muted-foreground">
                Elas contam no faturamento, mas não entram na comissão de ninguém. O vendedor
                sai do atendente responsável pelo lead no CRM.
              </span>
            </p>
            <Button size="sm" variant="outline" onClick={() => setLoteAberto(true)}>
              Atribuir em lote
            </Button>
          </div>
        </Card>
      )}

      {pendentesAntigas > 0 && (
        <Card className="border-amber-500/40">
          <p className="text-sm">
            <b className="text-amber-500">{pendentesAntigas} venda(s) pendente(s) há mais de 48h.</b>{" "}
            <span className="text-muted-foreground">
              Pagamento que não confirma sozinho pode ter travado no meio do caminho —
              confira na plataforma e corrija o status aqui (editar venda) se já foi pago.
              Pode estar fora do período selecionado acima.
            </span>
          </p>
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">Status</p>
            <div className="flex flex-wrap rounded-lg border border-border p-0.5">
              {["todos", "approved", "pending", "refunded"].map((s) => (
                <button
                  key={s}
                  onClick={() => setStatus(s)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                    status === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {s === "todos" ? "Todas" : ROTULO[s]?.texto || s}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 min-w-[200px]">
            <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">Buscar</p>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome ou e-mail do cliente…" className="h-9 pl-9 text-sm" />
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="px-4 py-3 font-medium">Vendedor</th>
                <th className="px-4 py-3 font-medium">Valor</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Data</th>
                {podeConfigurar && <th className="px-4 py-3 font-medium"></th>}
              </tr>
            </thead>
            <tbody>
              {lista.map((v: any) => {
                const r = ROTULO[v.status] || { texto: v.status, classe: "bg-muted text-muted-foreground" };
                const vendedor = v.leads?.assigned_to ? nomePor.get(v.leads.assigned_to) : null;
                return (
                  <tr key={v.id} className="border-b border-border/50 last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium">{v.leads?.name || "—"}</p>
                      <p className="text-xs text-muted-foreground">{v.leads?.email || ""}</p>
                    </td>
                    <td className="px-4 py-3">
                      {vendedor || <span className="text-amber-500 text-xs">não atribuída</span>}
                    </td>
                    <td className="px-4 py-3 font-semibold tabular-nums">{moeda(Number(v.amount) || 0)}</td>
                    <td className="px-4 py-3">
                      <span className={cn("rounded px-2 py-0.5 text-[10px] font-semibold uppercase", r.classe)}>
                        {r.texto}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground tabular-nums">
                      {format(new Date(v.created_at), "dd/MM HH:mm")}
                    </td>
                    {podeConfigurar && (
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-0.5">
                          <EditarVendaDialog
                            venda={{
                              id: v.id,
                              amount: v.amount,
                              status: v.status,
                              created_at: v.created_at,
                              lead_id: v.lead_id,
                              assignedTo: v.leads?.assigned_to ?? null,
                            }}
                            membros={membros}
                            ownerId={ownerId}
                          />
                          <ExcluirVendaButton vendaId={v.id} />
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!isLoading && lista.length === 0 && (
          <div className="p-6">
            <Vazio>Nenhuma venda com esses filtros no período.</Vazio>
          </div>
        )}
        {isLoading && (
          <div className="p-6">
            <Vazio>Carregando…</Vazio>
          </div>
        )}
      </Card>

      <AtribuirVendedorLoteDialog
        open={loteAberto}
        onOpenChange={setLoteAberto}
        vendas={vendasSemVendedor}
        membros={membros}
      />
    </div>
  );
}
