import { useAuth } from "@/contexts/AuthContext";
import { useProfile } from "@/hooks/use-profile";
import { RevenueHero } from "@/components/dashboard/RevenueHero";
import { KpiGrid } from "@/components/dashboard/KpiGrid";
import { AiInsights } from "@/components/dashboard/AiInsights";
import { QuickActions } from "@/components/dashboard/QuickActions";
import { SalesRanking } from "@/components/dashboard/SalesRanking";
import { RecentOrders } from "@/components/dashboard/RecentOrders";
import { BroadcastMetricsPanel } from "@/components/dashboard/BroadcastMetricsPanel";
import { SpendByAccountPanel } from "@/components/dashboard/SpendByAccountPanel";
import { LiveSendingProgress } from "@/components/dashboard/LiveSendingProgress";

interface DashboardHomeProps {
  /** Called when user clicks an action that should switch the parent tab. */
  onNavigateTab?: (tab: string) => void;
}

export function DashboardHome({ onNavigateTab }: DashboardHomeProps) {
  const { user } = useAuth();
  const { isSuperAdmin } = useProfile();
  const greeting = getGreeting();
  const name = user?.email?.split("@")[0] || "por aqui";

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1400px] mx-auto space-y-6 animate-fade-in">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-display font-bold tracking-tight">
          {greeting}, <span className="capitalize">{name}</span> 👋
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Aqui está como seu negócio está performando hoje.
        </p>
      </div>

      {/* Hero + KPIs (revenue hero apenas para admin) */}
      {isSuperAdmin ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <RevenueHero />
          </div>
          <div className="grid grid-cols-1 gap-4">
            <QuickActions onNavigate={(t) => onNavigateTab?.(t)} />
          </div>
        </div>
      ) : (
        <QuickActions onNavigate={(t) => onNavigateTab?.(t)} />
      )}

      <LiveSendingProgress />

      <KpiGrid />



      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <BroadcastMetricsPanel />
        </div>
        <SpendByAccountPanel />
      </div>

      {/* Insights + Ranking */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AiInsights
          onActionClick={(id) => {
            if (id.includes("pending")) onNavigateTab?.("chat");
            else if (id.includes("flows")) onNavigateTab?.("flows");
            else if (id.includes("campaign") || id.includes("readrate")) onNavigateTab?.("broadcast");
          }}
        />
        {isSuperAdmin && <SalesRanking />}
      </div>

      {isSuperAdmin && <RecentOrders />}
    </div>
  );
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 6) return "Boa madrugada";
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}
