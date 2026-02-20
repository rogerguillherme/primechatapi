import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWhatsAppAccounts } from "@/hooks/use-whatsapp-accounts";

export function useUserTemplates(enabled = true) {
  const { accounts, isLoading: accountsLoading } = useWhatsAppAccounts();
  const accountIds = accounts.map((a) => a.id);

  const { data: templates, isLoading } = useQuery({
    queryKey: ["user-templates", accountIds],
    queryFn: async () => {
      if (accountIds.length === 0) return [];

      // Get template IDs linked to user's accounts
      const { data: links } = await supabase
        .from("account_templates")
        .select("template_id")
        .in("account_id", accountIds);

      if (!links || links.length === 0) return [];

      const templateIds = [...new Set(links.map((l) => l.template_id))];

      const { data } = await supabase
        .from("chat_templates")
        .select("*")
        .in("id", templateIds)
        .order("name");

      return data || [];
    },
    enabled: enabled && !accountsLoading && accountIds.length > 0,
  });

  return { templates: templates || [], isLoading: isLoading || accountsLoading };
}
