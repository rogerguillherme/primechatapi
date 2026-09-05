import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface ChatLabel {
  id: string;
  name: string;
  color: string;
  /** Coluna do Kanban para onde o lead vai quando esta etiqueta é aplicada. */
  stage_id: string | null;
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
        .select("id, name, color, stage_id")
        .order("name");
      if (error) throw error;
      return (data || []) as ChatLabel[];
    },
    staleTime: 60_000,
  });

  return { labels: data || [], isLoading };
}

/**
 * Aplica/remove uma etiqueta de um lead. Ponto único de toggle — o chat, o
 * painel de contato e o kanban passam por aqui.
 *
 * Mover o lead para a coluna da etiqueta é responsabilidade do trigger
 * `trg_apply_label_stage` no banco, para que o webhook (link de
 * compartilhamento) se comporte igual sem duplicar a regra.
 */
export function useToggleLeadLabel(leadId: string | null | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ labelId, applied }: { labelId: string; applied: boolean }) => {
      if (!leadId) throw new Error("Nenhuma conversa selecionada");
      if (applied) {
        const { error } = await supabase
          .from("lead_labels")
          .delete()
          .eq("lead_id", leadId)
          .eq("label_id", labelId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("lead_labels")
          .insert({ lead_id: leadId, label_id: labelId });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead-labels-map"] });
      queryClient.invalidateQueries({ queryKey: ["lead-labels-contact", leadId] });
      // A etiqueta pode ter movido o lead de coluna (trigger no banco).
      queryClient.invalidateQueries({ queryKey: ["chat-leads"] });
      queryClient.invalidateQueries({ queryKey: ["kanban-leads"] });
      queryClient.invalidateQueries({ queryKey: ["contact-info-lead", leadId] });
    },
    onError: (e: Error) => toast.error(e.message || "Erro ao alterar etiqueta"),
  });
}
