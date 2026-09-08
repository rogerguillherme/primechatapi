import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Diz se o botão "IA ON/OFF" deve aparecer no cabeçalho da conversa.
 *
 * A decisão é da conta (dono). Vendedores convidados não conseguem ler o
 * perfil do dono por RLS, então a leitura passa por uma função no banco que
 * devolve apenas este booleano — assim desligar nas Configurações também
 * remove o botão para toda a equipe.
 */
export function useChatAiButtonEnabled() {
  const { user } = useAuth();

  const { data } = useQuery({
    queryKey: ["chat-ai-button", user?.id],
    enabled: !!user,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_owner_chat_ai_button" as never);
      if (error) throw error;
      return data as unknown as boolean;
    },
  });

  // Enquanto carrega, não mostra o botão: é melhor ele aparecer um instante
  // depois do que piscar para quem escolheu ocultá-lo.
  return data === true;
}
