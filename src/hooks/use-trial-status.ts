import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * trial_ends_at is only set for self-signup accounts (/teste-gratis).
 * Admin-created accounts have it NULL and never expire.
 */
export function useTrialStatus() {
  const { user, session } = useAuth();

  const { data: trialEndsAt, isLoading } = useQuery({
    queryKey: ["trial-status", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", user!.id)
        .single();
      if (error) throw error;
      return ((data as Record<string, unknown>)?.trial_ends_at as string | null) ?? null;
    },
    enabled: !!session && !!user,
  });

  const isExpired = !!trialEndsAt && new Date(trialEndsAt) < new Date();

  return { trialEndsAt, isExpired, loading: isLoading };
}
