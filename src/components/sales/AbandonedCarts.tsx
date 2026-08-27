import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { DateRangeFilter, type DateRange } from "@/components/DateRangeFilter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { startFlowForLead } from "@/lib/startFlowForLead";
import { OPEN_LEAD_KEY } from "@/lib/openLeadInChat";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Search, ShoppingCart, MessageCircle, Workflow, Loader2 } from "lucide-react";

interface AbandonedRow {
  id: string;
  lead_id: string;
  external_order_id: string;
  amount: number;
  created_at: string;
  leads: { name: string | null; phone: string | null } | null;
  products: { checkout_name: string | null } | null;
}

const brl = (v: number) =>
  (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Carrinhos abandonados que já chegaram pelo webhook das plataformas.
 *
 * A lista existe para ser trabalhada, não contemplada: cada linha leva direto
 * à conversa do lead ou dispara um fluxo de recuperação.
 */
interface AbandonedCartsProps {
  /** Leva para a aba de conversas. A navegação é por abas, não por rota. */
  onOpenChat?: () => void;
}

export function AbandonedCarts({ onOpenChat }: AbandonedCartsProps) {
  const [search, setSearch] = useState("");
  const [dateRange, setDateRange] = useState<DateRange>({ from: undefined, to: undefined });
  const [startingId, setStartingId] = useState<string | null>(null);

  const { data: carts, isLoading, refetch } = useQuery({
    queryKey: ["abandoned-carts", dateRange.from?.toISOString(), dateRange.to?.toISOString()],
    queryFn: async () => {
      let query = supabase
        .from("orders")
        .select("id, lead_id, external_order_id, amount, created_at, leads(name, phone), products(checkout_name)")
        .eq("status", "abandoned")
        .order("created_at", { ascending: false })
        .limit(500);
      if (dateRange.from) query = query.gte("created_at", dateRange.from.toISOString());
      if (dateRange.to) query = query.lte("created_at", dateRange.to.toISOString());
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as unknown as AbandonedRow[];
    },
  });

  const { data: flows } = useQuery({
    queryKey: ["chat-flows-all"],
    queryFn: async () => {
      const { data } = await supabase.from("flows").select("id, name, active").order("name");
      return data || [];
    },
    staleTime: 60_000,
  });

  // Busca por nome, telefone, produto ou número do pedido. A lista já vem
  // recortada por período no banco, então filtrar aqui não esconde nada.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return carts || [];
    return (carts || []).filter((c) =>
      [c.leads?.name, c.leads?.phone, c.products?.checkout_name, c.external_order_id]
        .some((v) => (v || "").toLowerCase().includes(q)),
    );
  }, [carts, search]);

  const total = useMemo(
    () => filtered.reduce((sum, c) => sum + (Number(c.amount) || 0), 0),
    [filtered],
  );

  const openInChat = (leadId: string) => {
    // A aba de conversas lê esta chave ao montar; o Radix desmonta a aba
    // inativa, então trocar de aba é o que dispara a leitura.
    try { sessionStorage.setItem(OPEN_LEAD_KEY, leadId); } catch { /* sem handoff */ }
    onOpenChat?.();
  };

  const recover = async (cart: AbandonedRow, flowId: string) => {
    setStartingId(cart.id);
    try {
      await startFlowForLead({ flowId, leadId: cart.lead_id });
      toast.success(`Fluxo iniciado para ${cart.leads?.name || "o lead"}`);
    } catch (e: any) {
      console.error("[carrinho] falha ao iniciar fluxo:", e);
      toast.error(e.message || "Erro ao iniciar fluxo");
    } finally {
      setStartingId(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Carrinho abandonado"
        description="Quem começou a compra e não finalizou. Recupere pela conversa ou por um fluxo."
        onRefresh={() => refetch()}
      />

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="max-w-sm relative flex-1 min-w-[14rem]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Nome, telefone, produto ou pedido"
            className="pl-9"
          />
        </div>
        <DateRangeFilter value={dateRange} onChange={setDateRange} />
        <div className="ml-auto flex items-center gap-2 text-sm">
          <Badge variant="secondary">{filtered.length} carrinhos</Badge>
          <Badge variant="outline" className="tabular-nums">{brl(total)} deixados na mesa</Badge>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-10 justify-center">
          <Loader2 size={16} className="animate-spin" /> Carregando...
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto">
            <ShoppingCart size={22} className="text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">
            {search || dateRange.from
              ? "Nenhum carrinho abandonado nesse recorte."
              : "Nenhum carrinho abandonado registrado ainda."}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left">
                <th className="px-4 py-2.5 font-medium">Cliente</th>
                <th className="px-4 py-2.5 font-medium">Produto</th>
                <th className="px-4 py-2.5 font-medium text-right">Valor</th>
                <th className="px-4 py-2.5 font-medium">Quando</th>
                <th className="px-4 py-2.5 font-medium text-right">Recuperar</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((cart) => (
                <tr key={cart.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-2.5">
                    <p className="font-medium truncate max-w-[16rem]">{cart.leads?.name || "Sem nome"}</p>
                    <p className="text-xs text-muted-foreground">{cart.leads?.phone || "—"}</p>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground truncate max-w-[18rem]">
                    {cart.products?.checkout_name || "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{brl(cart.amount)}</td>
                  <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                    {format(new Date(cart.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5 justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        onClick={() => openInChat(cart.lead_id)}
                      >
                        <MessageCircle size={14} /> Conversa
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="outline" className="gap-1.5" disabled={startingId === cart.id}>
                            {startingId === cart.id
                              ? <Loader2 size={14} className="animate-spin" />
                              : <Workflow size={14} />}
                            Fluxo
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                          {(flows || []).length === 0 && (
                            <div className="px-2 py-1.5 text-xs text-muted-foreground">
                              Nenhum fluxo criado ainda.
                            </div>
                          )}
                          {(flows || []).map((f: any) => (
                            <DropdownMenuItem key={f.id} onClick={() => recover(cart, f.id)} className="gap-2">
                              <Workflow size={14} className="opacity-60 shrink-0" />
                              <span className="flex-1 truncate">{f.name}</span>
                              {!f.active && (
                                <span className="text-[10px] text-muted-foreground">inativo</span>
                              )}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
