import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { TrendingUp } from "lucide-react";
import { PremiumCard } from "@/components/premium/PremiumCard";
import { EmptyStatePremium } from "@/components/premium/EmptyStatePremium";

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v || 0);

export function SalesRanking() {
  const { data: ranking } = useQuery({
    queryKey: ["sales-ranking-30d"],
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("orders")
        .select("product_id, amount, external_order_id, webhook_payload, products(checkout_name)")
        .eq("status", "approved")
        .gte("created_at", since);
      if (!data) return [];
      const main = data.filter(
        (o: any) => !o.external_order_id?.includes("-offer") && !o.external_order_id?.includes("-tester")
      );
      const map = new Map<string, { name: string; count: number; revenue: number }>();
      for (const o of main) {
        const name = (o as any).products?.checkout_name || "Sem produto";
        const key = o.product_id || "none";
        const entry = map.get(key) || { name, count: 0, revenue: 0 };
        entry.count++;
        const seller = (o.webhook_payload as any)?.event?.invoice?.receivers?.find((r: any) => r.role === "seller");
        const net = seller ? seller.totalCents / 100 : Number(o.amount);
        entry.revenue += net;
        map.set(key, entry);
      }
      return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
    },
  });

  const top = ranking || [];
  const medals = ["🥇", "🥈", "🥉"];

  return (
    <PremiumCard className="p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-display font-semibold text-sm">🏆 Ranking de vendas</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">Últimos 30 dias</p>
        </div>
      </div>
      {top.length === 0 ? (
        <EmptyStatePremium
          icon={TrendingUp}
          title="Sem vendas no período"
          description="Quando suas campanhas começarem a converter, os top produtos aparecem aqui."
          variant="subtle"
        />
      ) : (
        <div className="space-y-1.5">
          {top.map((p, i) => (
            <div
              key={p.name + i}
              className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-surface-subtle transition-colors"
            >
              <div className="w-7 text-center text-lg shrink-0">
                {medals[i] || <span className="text-xs font-semibold text-muted-foreground">{i + 1}º</span>}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{p.name}</p>
                <p className="text-[11px] text-muted-foreground tabular-nums">
                  {p.count} {p.count === 1 ? "venda" : "vendas"}
                </p>
              </div>
              <p className="text-sm font-display font-bold text-revenue tabular-nums shrink-0">
                {fmtBRL(p.revenue)}
              </p>
            </div>
          ))}
        </div>
      )}
    </PremiumCard>
  );
}
