import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Users, ShoppingCart, CheckCircle2, XCircle, Search } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useFavicon } from "@/hooks/use-favicon";
import { Input } from "@/components/ui/input";
import { Card, Kpi, TituloPagina, Vazio, moeda } from "@/components/metrics/ui";
import { cn } from "@/lib/utils";

/**
 * Clientes: os leads da operação, com o estágio comercial de cada um.
 *
 * A lista sai da MESMA tabela `leads` do Prime Chat, e o estágio do kanban é a
 * mesma coluna. Um CRM paralelo aqui criaria dois status para o mesmo contato,
 * e o vendedor passaria a atualizar um e esquecer o outro.
 */
export default function MetrikClientes() {
  useFavicon("/metrik-favicon.svg");

  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState("todos");

  const { data: leads = [], isLoading } = useQuery({
    queryKey: ["metrik-clientes"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("leads")
        .select("id, name, email, phone, chat_status, created_at, last_inbound_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: convertidos = 0 } = useQuery({
    queryKey: ["metrik-clientes-convertidos"],
    queryFn: async () => {
      // Convertido = tem pelo menos uma venda aprovada. Vem de `orders`, não de
      // um campo próprio: status copiado do outro lado desatualiza e mente.
      const { count, error } = await (supabase as any)
        .from("orders")
        .select("lead_id", { count: "exact", head: true })
        .eq("status", "approved");
      if (error) throw error;
      return count ?? 0;
    },
  });

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (leads as any[]).filter((l) => {
      if (status !== "todos" && l.chat_status !== status) return false;
      if (!termo) return true;
      return (
        (l.name || "").toLowerCase().includes(termo) ||
        (l.email || "").toLowerCase().includes(termo) ||
        (l.phone || "").includes(termo)
      );
    });
  }, [leads, busca, status]);

  const statusUnicos = useMemo(() => {
    const s = new Set<string>();
    for (const l of leads as any[]) if (l.chat_status) s.add(l.chat_status);
    return [...s];
  }, [leads]);

  return (
    <div className="space-y-6">
      <TituloPagina titulo="Clientes" sub="Leads da operação e em que ponto cada um está" />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi rotulo="Leads carregados" valor={String(leads.length)} nota="500 mais recentes" icone={Users} destaque />
        <Kpi rotulo="Vendas aprovadas" valor={String(convertidos)} nota="total histórico" icone={CheckCircle2} />
        <Kpi rotulo="Em atendimento" valor={String((leads as any[]).filter((l) => l.chat_status === "open").length)} icone={ShoppingCart} />
        <Kpi rotulo="Encerrados" valor={String((leads as any[]).filter((l) => l.chat_status === "done").length)} icone={XCircle} />
      </div>

      <Card>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">Estágio</p>
            <div className="flex flex-wrap rounded-lg border border-border p-0.5">
              {["todos", ...statusUnicos].map((s) => (
                <button
                  key={s}
                  onClick={() => setStatus(s)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                    status === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {s === "todos" ? "Todos" : s}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 min-w-[200px]">
            <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">Buscar</p>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome, e-mail ou telefone…" className="h-9 pl-9 text-sm" />
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {lista.slice(0, 120).map((l: any) => (
          <Card key={l.id} hover>
            <p className="font-medium truncate">{l.name || "Sem nome"}</p>
            <p className="text-xs text-muted-foreground truncate">{l.email || l.phone || "—"}</p>
            <div className="mt-3 flex items-center justify-between gap-2">
              {l.chat_status && (
                <span className="rounded bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase text-secondary-foreground">
                  {l.chat_status}
                </span>
              )}
              <span className="ml-auto text-[11px] text-muted-foreground">
                {l.last_inbound_at
                  ? `escreveu há ${formatDistanceToNowStrict(new Date(l.last_inbound_at), { locale: ptBR })}`
                  : "nunca escreveu"}
              </span>
            </div>
          </Card>
        ))}
      </div>

      {!isLoading && lista.length === 0 && <Vazio>Nenhum cliente com esses filtros.</Vazio>}
      {isLoading && <Vazio>Carregando…</Vazio>}
      {lista.length > 120 && (
        <Vazio>Mostrando os 120 primeiros de {lista.length}. Refine a busca para ver outros.</Vazio>
      )}
    </div>
  );
}
