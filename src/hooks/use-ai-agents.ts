import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function useAiAgents() {
  const { user } = useAuth();

  const { data: agents = [], isLoading } = useQuery({
    queryKey: ["ai-agents"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_agents")
        .select("id, name, active")
        .order("name");
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  return { agents, isLoading };
}
