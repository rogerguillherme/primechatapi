import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { DateRangeFilter, type DateRange } from "@/components/DateRangeFilter";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Input } from "@/components/ui/input";
import { Search, ChevronDown, ChevronRight } from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

function getBaseOrderId(externalId: string): string {
  return externalId.replace(/-offer-?\d*$/, "");
}

interface OrderGroup {
  baseId: string;
  leadName: string;
  orders: any[];
  totalAmount: number;
  mainOrder: any;
  hasOffers: boolean;
}

function groupOrders(orders: any[]): OrderGroup[] {
  const map = new Map<string, any[]>();
  for (const order of orders) {
    const base = getBaseOrderId(order.external_order_id);
    if (!map.has(base)) map.set(base, []);
    map.get(base)!.push(order);
  }
  const groups: OrderGroup[] = [];
  for (const [baseId, items] of map) {
    const main = items.find((o: any) => !o.external_order_id.includes("-offer")) || items[0];
    groups.push({
      baseId,
      leadName: main.leads?.name || "—",
      orders: items,
      totalAmount: main.amount || 0,
      mainOrder: main,
      hasOffers: items.length > 1,
    });
  }
  groups.sort((a, b) => new Date(b.mainOrder.created_at).getTime() - new Date(a.mainOrder.created_at).getTime());
  return groups;
}

/** Teto de exibição. O total real vem do banco e aparece ao lado da busca. */
const PAGE_SIZE = 200;

const fmt = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

export default function Orders() {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dateRange, setDateRange] = useState<DateRange>({ from: undefined, to: undefined });
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel("orders-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        queryClient.invalidateQueries({ queryKey: ["orders"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  // Espera a digitação parar: sem isso é uma consulta por tecla.
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const { data: result, isLoading } = useQuery({
    queryKey: ["orders", debounced, dateRange.from?.toISOString(), dateRange.to?.toISOString()],
    queryFn: async () => {
      // A busca roda no banco (nome, telefone, e-mail, produto e número do
      // pedido). Filtrar no navegador só enxergaria as primeiras 1.000 linhas
      // que o Supabase devolve, e esconderia o resto sem avisar.
      const { data, error } = await (supabase as any).rpc("search_orders", {
        p_search: debounced || null,
        p_statuses: null,
        p_from: dateRange.from ? dateRange.from.toISOString() : null,
        p_to: dateRange.to ? dateRange.to.toISOString() : null,
        p_limit: PAGE_SIZE,
        p_offset: 0,
      });
      if (error) throw error;

      const rows = (data || []) as any[];
      return {
        total: rows.length ? Number(rows[0].total_count) : 0,
        // Reaproveita o formato aninhado que o resto da tela já espera.
        orders: rows.map((r) => ({
          id: r.id,
          lead_id: r.lead_id,
          product_id: r.product_id,
          external_order_id: r.external_order_id,
          amount: r.amount,
          status: r.status,
          payment_method: r.payment_method,
          created_at: r.created_at,
          updated_at: r.updated_at,
          leads: { name: r.lead_name, phone: r.lead_phone, email: r.lead_email },
          products: { checkout_name: r.product_name },
        })),
      };
    },
  });

  const orders = result?.orders;

  const groups = useMemo(() => groupOrders(orders || []), [orders]);

  const toggle = (baseId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(baseId)) next.delete(baseId);
      else next.add(baseId);
      return next;
    });
  };

  return (
    <div>
      <PageHeader title="Pedidos" description="Todos os pedidos recebidos via webhook" onRefresh={() => queryClient.invalidateQueries({ queryKey: ["orders"] })} />
      <div className="flex items-center gap-4 mb-4 flex-wrap">
        <div className="max-w-sm relative flex-shrink-0">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Nome, telefone, e-mail, produto ou pedido" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <DateRangeFilter value={dateRange} onChange={setDateRange} />
        {result && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {result.total > PAGE_SIZE
              ? `mostrando ${result.orders.length} de ${result.total.toLocaleString("pt-BR")}`
              : `${result.total.toLocaleString("pt-BR")} pedidos`}
          </span>
        )}
      </div>
      <div className="bg-card rounded-xl border border-border shadow-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="w-10"></TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">ID Externo</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cliente</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Produto</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Valor</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pagamento</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Data</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  {isLoading ? "Carregando..." : "Nenhum pedido encontrado."}
                </TableCell>
              </TableRow>
            ) : (
              groups.map((group) => {
                const isExpanded = expanded.has(group.baseId);
                const main = group.mainOrder;
                return (
                  <> 
                    <TableRow
                      key={group.baseId}
                      className={group.hasOffers ? "cursor-pointer hover:bg-accent/50" : "hover:bg-accent/50"}
                      onClick={() => group.hasOffers && toggle(group.baseId)}
                    >
                      <TableCell className="w-10 px-2">
                        {group.hasOffers && (
                          isExpanded
                            ? <ChevronDown size={16} className="text-muted-foreground" />
                            : <ChevronRight size={16} className="text-muted-foreground" />
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {group.baseId}
                        {group.hasOffers && (
                          <span className="ml-2 text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium">
                            +{group.orders.length - 1} bump{group.orders.length - 1 > 1 ? "s" : ""}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>{group.leadName}</TableCell>
                      <TableCell>
                        {group.hasOffers
                          ? `${group.orders.length} produtos`
                          : main.products?.checkout_name || "—"}
                      </TableCell>
                      <TableCell className="font-semibold">{fmt(group.totalAmount)}</TableCell>
                      <TableCell>{main.payment_method || "—"}</TableCell>
                      <TableCell><StatusBadge status={main.status} /></TableCell>
                      <TableCell>{format(new Date(main.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}</TableCell>
                    </TableRow>
                    {isExpanded && group.orders.map((order: any) => (
                      <TableRow key={order.id} className="bg-muted/30">
                        <TableCell></TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground pl-6">
                          {order.external_order_id.includes("-offer") ? "↳ Order Bump" : "↳ Principal"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{order.leads?.name || "—"}</TableCell>
                        <TableCell>{order.products?.checkout_name || "—"}</TableCell>
                        <TableCell>{fmt(order.amount)}</TableCell>
                        <TableCell>{order.payment_method || "—"}</TableCell>
                        <TableCell><StatusBadge status={order.status} /></TableCell>
                        <TableCell>{format(new Date(order.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}</TableCell>
                      </TableRow>
                    ))}
                  </>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
