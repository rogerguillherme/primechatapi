import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PremiumCard } from "@/components/premium/PremiumCard";
import { InsightCard, InsightCardSkeleton, InsightsHeader, type Insight } from "@/components/premium/InsightCard";

interface AiInsightsProps {
  onActionClick?: (insightId: string) => void;
}

export function AiInsights({ onActionClick }: AiInsightsProps) {
  const { user } = useAuth();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboard-insights", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("dashboard-insights");
      if (error) throw error;
      return data as { insights: Insight[]; stats?: any; fallback?: string };
    },
    enabled: !!user,
    staleTime: 15 * 60 * 1000, // cache 15min
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const insights = data?.insights || [];

  return (
    <PremiumCard variant="ai" className="p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <InsightsHeader />
        {data?.fallback && (
          <span className="text-[10px] text-muted-foreground">Modo offline</span>
        )}
      </div>
      <div className="space-y-2.5">
        {isLoading || isError
          ? Array.from({ length: 3 }).map((_, i) => <InsightCardSkeleton key={i} />)
          : insights.map((ins) => (
              <InsightCard
                key={ins.id}
                insight={{
                  ...ins,
                  onAction: onActionClick ? () => onActionClick(ins.id) : undefined,
                }}
              />
            ))}
      </div>
    </PremiumCard>
  );
}
