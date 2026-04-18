import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ShoppingBag } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { PremiumCard } from "@/components/premium/PremiumCard";
import { EmptyStatePremium } from "@/components/premium/EmptyStatePremium";
import { StatusBadge } from "@/components/StatusBadge";

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);

export function RecentOrders() {
  const { data: orders } = useQuery({
    queryKey: ["recent-orders-home"],
    queryFn: async () => {
      const { data } = await supabase
        .from("orders")
        .select("id, amount, status, created_at, external_order_id, leads(name), products(checkout_name)")
        .order("created_at", { ascending: false })
        .limit(6);
      return data || [];
    },
    refetchInterval: 60_000,
  });

  return (
    <PremiumCard className="p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-display font-semibold text-sm">Vendas recentes</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">Últimas transações</p>
        </div>
      </div>
      {!orders || orders.length === 0 ? (
        <EmptyStatePremium
          icon={ShoppingBag}
          title="Nenhuma venda ainda"
          description="Suas vendas aparecerão aqui assim que o webhook do checkout começar a receber dados."
          variant="subtle"
        />
      ) : (
        <div className="space-y-1.5">
          {orders.map((o: any) => (
            <div key={o.id} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-surface-subtle transition-colors">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{o.leads?.name || "Cliente"}</p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {o.products?.checkout_name || "—"} · {format(new Date(o.created_at), "dd/MM HH:mm", { locale: ptBR })}
                </p>
              </div>
              <p className="text-sm font-display font-bold tabular-nums shrink-0">{fmtBRL(Number(o.amount))}</p>
              <StatusBadge status={o.status} />
            </div>
          ))}
        </div>
      )}
    </PremiumCard>
  );
}
