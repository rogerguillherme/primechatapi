import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTeamContext } from "@/hooks/use-team";
import { useAccountStatsToday } from "@/hooks/use-account-stats-today";
import { Users, Reply } from "lucide-react";
import { PremiumCard } from "@/components/premium/PremiumCard";
import { cn } from "@/lib/utils";

interface Kpi {
  label: string;
  value: string;
  hint?: string;
  icon: any;
  accent: "ai" | "revenue" | "primary" | "warning";
}

const accentMap = {
  ai: "bg-ai/10 text-ai",
  revenue: "bg-revenue/10 text-revenue",
  primary: "bg-primary/10 text-primary",
  warning: "bg-warning/10 text-warning",
};

export function KpiGrid() {
  const { user } = useAuth();
  // Um colaborador logado com o próprio user.id não é dono dos leads — eles
  // ficam sob o user_id de quem criou a conta. Contar pelo id de quem está
  // logado zera (ou erra) os números para todo mundo que não é o dono.
  const { data: team } = useTeamContext();
  const ownerId = team?.ownerId;

  const { data: stats } = useQuery({
    queryKey: ["dashboard-kpis", ownerId],
    queryFn: async () => {
      if (!ownerId) return null;
      const { data } = await supabase.rpc("get_advanced_dashboard_stats", { p_user_id: ownerId });
      const row = data?.[0] || null;

      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const { count: leadsToday } = await supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("user_id", ownerId)
        .gte("created_at", startOfToday.toISOString());

      return {
        leadsToday: leadsToday ?? 0,
        responseRate: Number(row?.response_rate || 0),
      };
    },
    enabled: !!user && !!ownerId,
    refetchInterval: 60_000,
  });

  // Separação de "Novos contatos hoje" por número — só faz sentido mostrar
  // quando a conta tem mais de um WhatsApp conectado.
  const { data: accountStats } = useAccountStatsToday();
  const porNumero = (accountStats || []).filter((a) => a.leads_today > 0);

  const kpis: Kpi[] = [
    {
      label: "Novos contatos hoje",
      value: String(stats?.leadsToday ?? 0),
      hint: "Leads capturados nas últimas 24h",
      icon: Users,
      accent: "primary",
    },
    {
      label: "Taxa de resposta",
      value: `${stats?.responseRate ?? 0}%`,
      hint: "Leads que responderam",
      icon: Reply,
      accent: "revenue",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">

      {kpis.map((k) => (
        <PremiumCard key={k.label} className="p-4 sm:p-5">
          <div className="flex items-start justify-between gap-2 mb-3">
            <p className="text-[11px] sm:text-xs font-medium uppercase tracking-wider text-muted-foreground leading-tight">
              {k.label}
            </p>
            <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", accentMap[k.accent])}>
              <k.icon size={15} strokeWidth={2.2} />
            </div>
          </div>
          <p className="text-2xl sm:text-3xl font-display font-bold tabular-nums leading-none">
            {k.value}
          </p>
          {k.hint && (
            <p className="text-[11px] text-muted-foreground mt-2 leading-tight">{k.hint}</p>
          )}
          {k.label === "Novos contatos hoje" && porNumero.length > 1 && (
            <div className="mt-2.5 pt-2.5 border-t border-border/60 space-y-1">
              {porNumero.map((a) => (
                <div key={a.account_id} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-muted-foreground truncate">{a.display_phone_number || a.name}</span>
                  <span className="font-medium tabular-nums shrink-0">{a.leads_today}</span>
                </div>
              ))}
            </div>
          )}
        </PremiumCard>
      ))}
    </div>
  );
}
