import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useWhatsAppAccounts() {
  const { data: accounts, isLoading } = useQuery({
    queryKey: ["whatsapp-accounts"],
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
