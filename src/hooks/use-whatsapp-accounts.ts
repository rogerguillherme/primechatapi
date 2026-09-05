import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function useWhatsAppAccounts() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const syncedRef = useRef(false);

  const { data: accounts, isLoading } = useQuery({
    queryKey: ["whatsapp-accounts", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_accounts")
        .select("*")
        .order("is_default", { ascending: false })
        .order("name");
      if (error) throw error;
      return data || [];
    },
  });

  // Backfill display phone numbers from Meta once per session when missing.
  useEffect(() => {
    if (!user || syncedRef.current || !accounts?.length) return;
    const missing = accounts.some(
      (a: any) => a.provider === "meta_cloud" && !a.display_phone_number
    );
    if (!missing) return;
    syncedRef.current = true;
    supabase.functions
      .invoke("whatsapp-sync-phone-numbers")
      .then(({ data }) => {
        if (data?.updated) {
          queryClient.invalidateQueries({ queryKey: ["whatsapp-accounts", user.id] });
        }
      })
      .catch(() => {
        /* non-blocking */
      });
  }, [accounts, user, queryClient]);

  const defaultAccount = accounts?.find((a) => a.is_default) || accounts?.[0];

  return { accounts: accounts || [], isLoading, defaultAccount };
}
