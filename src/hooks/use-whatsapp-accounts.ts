import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function useWhatsAppAccounts() {
  const { user } = useAuth();

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

  const defaultAccount = accounts?.find((a) => a.is_default) || accounts?.[0];

  return { accounts: accounts || [], isLoading, defaultAccount };
}
