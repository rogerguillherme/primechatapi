import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { MetricHero } from "@/components/premium/MetricHero";

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v || 0);

export function RevenueHero() {
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["revenue-hero", user?.id],
    queryFn: async () => {
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);

      const { data: orders } = await supabase
        .from("orders")
        .select("amount, status, created_at, external_order_id, webhook_payload")
        .eq("status", "approved")
        .gte("created_at", startOfYesterday.toISOString());

      const main = (orders || []).filter(
        (o: any) => !o.external_order_id?.includes("-offer") && !o.external_order_id?.includes("-tester")
      );

      const sumNet = (list: any[]) =>
        list.reduce((s, o) => {
          const seller = o.webhook_payload?.event?.invoice?.receivers?.find((r: any) => r.role === "seller");
          return s + (seller ? seller.totalCents / 100 : Number(o.amount || 0));
        }, 0);

      const todayList = main.filter((o: any) => new Date(o.created_at) >= startOfToday);
      const yesterdayList = main.filter(
        (o: any) =>
          new Date(o.created_at) >= startOfYesterday && new Date(o.created_at) < startOfToday
      );

      const today = sumNet(todayList);
      const yesterday = sumNet(yesterdayList);
      const delta = yesterday > 0 ? Math.round(((today - yesterday) / yesterday) * 100) : null;

      return { today, yesterday, delta, ordersToday: todayList.length };
    },
    enabled: !!user,
    refetchInterval: 60_000,
  });

  return (
    <MetricHero
      label="💰 Faturado hoje"
      value={fmtBRL(data?.today || 0)}
      deltaPercent={data?.delta}
      comparisonLabel="vs ontem"
      hint={
        data?.ordersToday
          ? `${data.ordersToday} ${data.ordersToday === 1 ? "venda aprovada" : "vendas aprovadas"} hoje`
          : "Nenhuma venda registrada hoje ainda"
      }
      variant="revenue"
      loading={isLoading}
    />
  );
}
