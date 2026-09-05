import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PremiumCard } from "@/components/premium/PremiumCard";
import { DollarSign, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

interface SpendRow {
  account_id: string;
  display_name: string;
  phone_number: string;
  sent: number;
  cost_usd: number;
  cost_brl: number;
  meta_amount_brl?: number;
  by_category: Record<string, number>;
}

interface SpendResp {
  month: string;
  total_sent: number;
  total_cost_usd: number;
  total_cost_brl: number;
  total_meta_brl?: number;
  source?: "meta" | "estimate";
  usd_to_brl: number;
  accounts: SpendRow[];
}

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function SpendByAccountPanel() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["spend-metrics", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("spend-metrics");
      if (error) throw error;
      return data as SpendResp;
    },
    enabled: !!user,
    refetchInterval: 5 * 60_000,
  });

  return (
    <PremiumCard className="p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center">
            <Wallet size={16} className="text-white" />
          </div>
          <div>
            <h3 className="font-display font-semibold text-sm">Gasto do mês por conta</h3>
            <p className="text-[11px] text-muted-foreground leading-none mt-0.5">
              {data?.month ? `Mês ${data.month}` : ""} {data?.source === "meta" ? "· Dados reais da Meta" : "· Estimativa"}
            </p>

          </div>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Total</p>
          <p className="text-lg font-bold text-foreground">
            {isLoading ? "…" : brl(data?.total_cost_brl || 0)}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-14 rounded-xl bg-muted animate-pulse" />
          ))
        ) : (data?.accounts.length ?? 0) === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">
            Nenhum disparo neste mês.
          </p>
        ) : (
          data!.accounts.map((a) => {
            const total = data!.total_cost_brl || 1;
            const pct = Math.round((a.cost_brl / total) * 100);
            return (
              <div key={a.account_id || a.display_name} className="rounded-xl border border-border/60 bg-surface-elevated p-3">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{a.display_name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {a.phone_number || "—"} · {Math.round(a.sent)} envios
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-emerald-600">{brl(a.cost_brl)}</p>
                    {a.meta_amount_brl !== undefined && (
                      <p className="text-[10px] text-muted-foreground">
                        Meta: {brl(a.meta_amount_brl)}
                      </p>
                    )}
                  </div>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className={cn("h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all")}
                    style={{ width: `${Math.min(100, pct)}%` }}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>

      <p className="text-[10px] text-muted-foreground mt-3 flex items-center gap-1">
        <DollarSign size={10} />
        {data?.source === "meta"
          ? "Valores reais faturados na Meta (BM)."
          : "Meta não retornou valores para este mês — mostrando estimativa com preços BR."}
      </p>

    </PremiumCard>
  );
}
