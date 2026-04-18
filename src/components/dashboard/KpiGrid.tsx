import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Users, Reply, Clock, Zap } from "lucide-react";
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

  const { data: stats } = useQuery({
    queryKey: ["dashboard-kpis", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase.rpc("get_advanced_dashboard_stats", { p_user_id: user.id });
      const row = data?.[0] || null;
      if (!row) return null;

      // Estimativa: cada mensagem automatizada economiza ~2min de operação
      const sentMsgs = Number(row.total_messages_sent || 0);
      const minutesSaved = sentMsgs * 2;
      const hoursSaved = Math.round(minutesSaved / 60);

      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const { count: leadsToday } = await supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .gte("created_at", startOfToday.toISOString());

      const { count: activeCampaigns } = await supabase
        .from("broadcast_jobs")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .in("status", ["running", "processing", "pending"]);

      return {
        leadsToday: leadsToday ?? 0,
        responseRate: Number(row.response_rate || 0),
        hoursSaved,
        activeCampaigns: activeCampaigns ?? 0,
      };
    },
    enabled: !!user,
    refetchInterval: 60_000,
  });

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
    {
      label: "IA economizou",
      value: `${stats?.hoursSaved ?? 0}h`,
      hint: "Tempo poupado pelas automações",
      icon: Clock,
      accent: "ai",
    },
    {
      label: "Campanhas ativas",
      value: String(stats?.activeCampaigns ?? 0),
      hint: "Disparos em andamento agora",
      icon: Zap,
      accent: "warning",
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
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
        </PremiumCard>
      ))}
    </div>
  );
}
