import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTeamContext } from "@/hooks/use-team";

export interface AccountStatToday {
  account_id: string;
  name: string;
  display_phone_number: string | null;
  provider: string;
  leads_today: number;
}

/** Rótulo de cada número + quantos leads entraram por ele hoje. */
export function useAccountStatsToday() {
  const { data: team } = useTeamContext();
  const ownerId = team?.ownerId;

  return useQuery({
    queryKey: ["account-stats-today", ownerId],
    enabled: !!ownerId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_account_stats_today", {
        p_owner_id: ownerId,
      });
      if (error) throw error;
      return (data || []) as AccountStatToday[];
    },
    refetchInterval: 60_000,
  });
}
