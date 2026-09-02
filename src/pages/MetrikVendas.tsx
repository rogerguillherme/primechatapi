import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import { DollarSign, Clock, RotateCcw, Search } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useMetrikData } from "@/hooks/use-metrik-data";
import { useFavicon } from "@/hooks/use-favicon";
import { Input } from "@/components/ui/input";
import { Card, Kpi, TituloPagina, Vazio, moeda } from "@/components/metrics/ui";
import { cn } from "@/lib/utils";

const ROTULO: Record<string, { texto: string; classe: string }> = {
  approved: { texto: "Confirmada", classe: "bg-primary/15 text-primary" },
  pending: { texto: "Pendente", classe: "bg-amber-500/15 text-amber-500" },
  refunded: { texto: "Reembolsada", classe: "bg-destructive/15 text-destructive" },
  chargeback: { texto: "Chargeback", classe: "bg-destructive/15 text-destructive" },
  cancelled: { texto: "Cancelada", classe: "bg-muted text-muted-foreground" },
};

export default function MetrikVendas() {
  useFavicon("/metrik-favicon.svg");

  const [mes] = useState(() => new Date());
  const inicio = useMemo(() => startOfMonth(mes), [mes]);
  const fim = useMemo(() => endOfMonth(mes), [mes]);
  const { membros } = useMetrikData(inicio, fim);

  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState<string>("todos");

  const { data: vendas = [], isLoading } = useQuery({
    queryKey: ["metrik-vendas", inicio.toISOString()],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("orders")
        .select("id, amount, status, created_at, payment_method, leads(name, email, assigned_to)")
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
      />

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
          <p className="text-sm">
            <b className="text-amber-500">{totais.naoAtribuidas} venda(s) sem vendedor.</b>{" "}
            <span className="text-muted-foreground">
              Elas contam no faturamento, mas não entram na comissão de ninguém. O vendedor
              sai do atendente responsável pelo lead no CRM — atribua lá e elas aparecem no
              ranking.
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
    </div>
  );
}
