import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { DateRangeFilter, type DateRange } from "@/components/DateRangeFilter";
import { DataTable } from "@/components/DataTable";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { Badge } from "@/components/ui/badge";

const fmt = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

export default function Refunds() {
  const [search, setSearch] = useState("");
  const [dateRange, setDateRange] = useState<DateRange>({ from: undefined, to: undefined });
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel("refunds-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        queryClient.invalidateQueries({ queryKey: ["refunds"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  const { data: refunds, isLoading } = useQuery({
    queryKey: ["refunds", search, dateRange.from?.toISOString(), dateRange.to?.toISOString()],
    queryFn: async () => {
      let query = supabase
        .from("orders")
        .select("*, leads(name, phone, email), products(checkout_name)")
        .in("status", ["refunded", "chargeback"])
        .order("updated_at", { ascending: false });
      if (search) {
        query = query.or(`external_order_id.ilike.%${search}%,leads.name.ilike.%${search}%`);
      }
      if (dateRange.from) query = query.gte("updated_at", dateRange.from.toISOString());
      if (dateRange.to) query = query.lte("updated_at", dateRange.to.toISOString());
      const { data } = await query;
      return data || [];
    },
  });

  const stats = useMemo(() => {
    if (!refunds) return { total: 0, amount: 0, chargebacks: 0 };
    return {
      total: refunds.length,
      amount: refunds.reduce((sum, r) => sum + (r.amount || 0), 0),
      chargebacks: refunds.filter((r) => r.status === "chargeback").length,
    };
  }, [refunds]);

  const columns = [
    {
      key: "external_order_id",
      header: "ID Externo",
      render: (row: any) => (
        <span className="font-mono text-xs">{row.external_order_id}</span>
      ),
    },
    {
      key: "lead",
      header: "Cliente",
      render: (row: any) => (
        <div>
          <p className="font-medium">{row.leads?.name || "—"}</p>
          <p className="text-xs text-muted-foreground">{row.leads?.phone || ""}</p>
        </div>
      ),
    },
    {
      key: "product",
      header: "Produto",
      render: (row: any) => row.products?.checkout_name || "—",
    },
    {
      key: "amount",
      header: "Valor",
      render: (row: any) => (
        <span className="font-semibold text-destructive">{fmt(row.amount)}</span>
      ),
    },
    {
      key: "payment_method",
      header: "Pagamento",
      render: (row: any) => row.payment_method || "—",
    },
    {
      key: "status",
      header: "Tipo",
      render: (row: any) => <StatusBadge status={row.status} />,
    },
    {
      key: "created_at",
      header: "Compra em",
      render: (row: any) => format(new Date(row.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR }),
    },
    {
      key: "updated_at",
      header: "Reembolso em",
      render: (row: any) => format(new Date(row.updated_at), "dd/MM/yyyy HH:mm", { locale: ptBR }),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Reembolsos"
        description="Pedidos reembolsados e chargebacks"
        onRefresh={() => queryClient.invalidateQueries({ queryKey: ["refunds"] })}
      />

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-card rounded-xl border border-border p-4 shadow-card">
          <p className="text-sm text-muted-foreground">Total de reembolsos</p>
          <p className="text-2xl font-bold mt-1">{stats.total}</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-4 shadow-card">
          <p className="text-sm text-muted-foreground">Valor total</p>
          <p className="text-2xl font-bold mt-1 text-destructive">{fmt(stats.amount)}</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-4 shadow-card">
          <p className="text-sm text-muted-foreground">Chargebacks</p>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-2xl font-bold">{stats.chargebacks}</p>
            {stats.chargebacks > 0 && (
              <Badge variant="destructive" className="text-[10px]">atenção</Badge>
            )}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 mb-4 flex-wrap">
        <div className="max-w-sm relative flex-shrink-0">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por ID ou nome..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <DateRangeFilter value={dateRange} onChange={setDateRange} />
      </div>

      <DataTable
        columns={columns}
        data={refunds || []}
        emptyMessage={isLoading ? "Carregando..." : "Nenhum reembolso encontrado."}
      />
    </div>
  );
}
