import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ChatLabel {
  id: string;
  name: string;
  color: string;
}

/**
 * Etiquetas (tags) do tenant atual — usadas no chat, kanban e nos passos de fluxo.
 * RLS já isola por user_id, então não filtramos manualmente aqui.
 */
export function useChatLabels() {
  const { data, isLoading } = useQuery({
    queryKey: ["chat-labels"],
    queryFn: async (): Promise<ChatLabel[]> => {
      const { data, error } = await supabase
        .from("chat_labels")
        .select("id, name, color")
        .order("name");
      if (error) throw error;
      return (data || []) as ChatLabel[];
    },
    staleTime: 60_000,
  });

  return { labels: data || [], isLoading };
}
