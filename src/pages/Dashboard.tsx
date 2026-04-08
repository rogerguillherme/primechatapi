import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Users, ShoppingCart, Package, DollarSign, CalendarClock, Repeat, TrendingUp, ArrowUpRight, MessageCircle, Clock, Percent, GitBranch } from "lucide-react";
import { StatCard } from "@/components/StatCard";
import { PageHeader } from "@/components/PageHeader";
import { DataTable } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { DateRangeFilter, type DateRange } from "@/components/DateRangeFilter";
import { ExportButton } from "@/components/ExportButton";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

export default function Dashboard() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [dateRange, setDateRange] = useState<DateRange>({ from: undefined, to: undefined });

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    queryClient.invalidateQueries({ queryKey: ["recent-orders"] });
    queryClient.invalidateQueries({ queryKey: ["sales-by-product"] });
  };

  const { data: stats } = useQuery({
    queryKey: ["dashboard-stats", dateRange.from?.toISOString(), dateRange.to?.toISOString()],
    queryFn: async () => {
      if (!dateRange.from) {
        const { data, error } = await supabase.rpc("get_dashboard_stats");
        if (error) throw error;
        return data?.[0] || { total_leads: 0, total_orders: 0, approved_revenue: 0, total_products: 0, expiring_soon_count: 0 };
      }

      let ordersQuery = supabase
        .from("orders")
        .select("amount, external_order_id, webhook_payload, lead_id, created_at")
        .eq("status", "approved")
        .gte("created_at", dateRange.from.toISOString());
      if (dateRange.to) ordersQuery = ordersQuery.lte("created_at", dateRange.to.toISOString());
      const { data: orders } = await ordersQuery;

      const mainOrders = (orders || []).filter(
        (o: any) => !o.external_order_id?.includes("-offer") && !o.external_order_id?.includes("-tester")
      );

      const revenue = mainOrders.reduce((sum: number, o: any) => {
        const sellerReceiver = o.webhook_payload?.event?.invoice?.receivers?.find((r: any) => r.role === "seller");
        return sum + (sellerReceiver ? sellerReceiver.totalCents / 100 : Number(o.amount));
      }, 0);

      const uniqueLeads = new Set(mainOrders.map((o: any) => o.lead_id)).size;

      return {
        total_leads: uniqueLeads,
        total_orders: mainOrders.length,
        approved_revenue: revenue,
        total_products: 0,
        expiring_soon_count: 0,
      };
    },
  });

  const { data: recentOrders } = useQuery({
    queryKey: ["recent-orders", dateRange.from?.toISOString(), dateRange.to?.toISOString()],
    queryFn: async () => {
      let query = supabase
        .from("orders")
        .select("*, leads(name, phone), products(checkout_name)")
        .order("created_at", { ascending: false })
        .limit(5);
      if (dateRange.from) query = query.gte("created_at", dateRange.from.toISOString());
      if (dateRange.to) query = query.lte("created_at", dateRange.to.toISOString());
      const { data } = await query;
      return data || [];
    },
  });

  const { data: recurrenceStats } = useQuery({
    queryKey: ["recurrence-stats", dateRange.from?.toISOString(), dateRange.to?.toISOString()],
    queryFn: async () => {
      let query = supabase
        .from("orders")
        .select("lead_id, external_order_id")
        .eq("status", "approved");
      if (dateRange.from) query = query.gte("created_at", dateRange.from.toISOString());
      if (dateRange.to) query = query.lte("created_at", dateRange.to.toISOString());
      const { data } = await query;
      const mainOrders = (data || []).filter(
        (o: any) => !o.external_order_id?.includes("-offer") && !o.external_order_id?.includes("-tester")
      );
      const countByLead = new Map<string, number>();
      for (const o of mainOrders) {
        countByLead.set(o.lead_id, (countByLead.get(o.lead_id) || 0) + 1);
      }
      const totalBuyers = countByLead.size;
      const returning = Array.from(countByLead.values()).filter((c) => c >= 2).length;
      return { totalBuyers, returning, rate: totalBuyers > 0 ? Math.round((returning / totalBuyers) * 100) : 0 };
    },
  });

  const { data: salesByProduct } = useQuery({
    queryKey: ["sales-by-product", dateRange.from?.toISOString(), dateRange.to?.toISOString()],
    queryFn: async () => {
      let query = supabase
        .from("orders")
        .select("product_id, amount, external_order_id, webhook_payload, products(checkout_name)")
        .eq("status", "approved");
      if (dateRange.from) query = query.gte("created_at", dateRange.from.toISOString());
      if (dateRange.to) query = query.lte("created_at", dateRange.to.toISOString());
      const { data } = await query;
      if (!data) return [];
      const mainOrders = data.filter(
        (o: any) => !o.external_order_id?.includes("-offer") && !o.external_order_id?.includes("-tester")
      );
      const map = new Map<string, { name: string; count: number; revenue: number }>();
      for (const o of mainOrders) {
        const name = (o as any).products?.checkout_name || "Sem produto";
        const key = o.product_id || "none";
        const entry = map.get(key) || { name, count: 0, revenue: 0 };
        entry.count++;
        const sellerReceiver = (o.webhook_payload as any)?.event?.invoice?.receivers?.find((r: any) => r.role === "seller");
        const netAmount = sellerReceiver ? sellerReceiver.totalCents / 100 : Number(o.amount);
        entry.revenue += netAmount;
        map.set(key, entry);
      }
      return Array.from(map.values()).sort((a, b) => b.count - a.count);
    },
  });

  const orderColumns = [
    { key: "leads", header: "Cliente", render: (row: any) => (
      <span className="font-medium">{row.leads?.name || "—"}</span>
    )},
    { key: "products", header: "Produto", render: (row: any) => (
      <span className="text-muted-foreground">{row.products?.checkout_name || "—"}</span>
    )},
    {
      key: "amount",
      header: "Valor",
      render: (row: any) => (
        <span className="font-semibold text-foreground">
          {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(row.amount)}
        </span>
      ),
    },
    { key: "status", header: "Status", render: (row: any) => <StatusBadge status={row.status} /> },
    {
      key: "created_at",
      header: "Data",
      render: (row: any) => (
        <span className="text-muted-foreground text-xs">
          {format(new Date(row.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
        </span>
      ),
    },
  ];

  const rankedProducts = (salesByProduct || []).map((p: any, i: number) => ({ ...p, rank: i + 1 }));

  const productColumns = [
    {
      key: "rank",
      header: "#",
      render: (row: any) => {
        const medals = ["🥇", "🥈", "🥉"];
        return <span className="text-lg">{medals[row.rank - 1] || `${row.rank}º`}</span>;
      },
    },
    { key: "name", header: "Produto", render: (row: any) => (
      <span className="font-medium">{row.name}</span>
    )},
    { key: "count", header: "Vendas", render: (row: any) => (
      <div className="flex items-center gap-1.5">
        <span className="font-semibold">{row.count}</span>
        <TrendingUp size={14} className="text-success" />
      </div>
    )},
    {
      key: "revenue",
      header: "Receita",
      render: (row: any) => (
        <span className="font-semibold text-foreground">
          {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(row.revenue)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Visão geral do Prime Chat</p>
        </div>
        <DateRangeFilter value={dateRange} onChange={setDateRange} />
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard title="Total de Leads" value={stats?.total_leads ?? 0} icon={Users} />
        <StatCard title="Pedidos" value={stats?.total_orders ?? 0} icon={ShoppingCart} />
        <StatCard
          title="Receita Aprovada"
          value={new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(stats?.approved_revenue ?? 0)}
          icon={DollarSign}
        />
        <StatCard
          title="Recorrentes"
          value={`${recurrenceStats?.returning ?? 0} (${recurrenceStats?.rate ?? 0}%)`}
          icon={Repeat}
        />
        {!dateRange.from && (
          <>
            <StatCard title="Produtos Ativos" value={stats?.total_products ?? 0} icon={Package} />
            <div className="cursor-pointer" onClick={() => navigate("/expirations")}>
              <StatCard title="Vencendo em 15d" value={stats?.expiring_soon_count ?? 0} icon={CalendarClock} />
            </div>
          </>
        )}
      </div>

      {/* Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card rounded-xl border border-border p-5 shadow-card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-display font-semibold text-foreground">🏆 Ranking de Vendas</h2>
          </div>
          <DataTable columns={productColumns} data={rankedProducts} emptyMessage="Nenhuma venda encontrada." />
        </div>
        <div className="bg-card rounded-xl border border-border p-5 shadow-card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-display font-semibold text-foreground">Pedidos Recentes</h2>
            <button
              onClick={() => navigate("/orders")}
              className="text-xs text-primary hover:text-primary/80 font-medium flex items-center gap-1 transition-colors"
            >
              Ver todos <ArrowUpRight size={12} />
            </button>
          </div>
          <DataTable columns={orderColumns} data={recentOrders || []} />
        </div>
      </div>
    </div>
  );
}
