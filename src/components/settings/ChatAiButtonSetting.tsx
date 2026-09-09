import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useProfile } from "@/hooks/use-profile";
import { CollapsibleSettingsCard } from "@/components/settings/CollapsibleSettingsCard";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Bot } from "lucide-react";

/**
 * Liga/desliga a exibição do botão do agente IA no cabeçalho da conversa.
 *
 * Só esconde o botão: o modo do agente (desligado / todas / selecionadas)
 * continua valendo, para não desligar respostas automáticas sem aviso.
 */
export function ChatAiButtonSetting() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const queryClient = useQueryClient();

  const enabled = profile?.chat_ai_button !== false;

  const save = useMutation({
    mutationFn: async (value: boolean) => {
      if (!user) throw new Error("Usuário não autenticado");
      const { error } = await supabase
        .from("profiles")
        .update({ chat_ai_button: value } as never)
        .eq("user_id", user.id);
      if (error) throw error;
      return value;
    },
    onSuccess: (value) => {
      queryClient.setQueryData(["chat-ai-button", user?.id], value);
      queryClient.invalidateQueries({ queryKey: ["profile", user?.id] });
      // O chat lê a configuração da conta por RPC (vale para a equipe também).
      queryClient.invalidateQueries({ queryKey: ["chat-ai-button"] });
      toast.success(value ? "Botão do agente IA visível no chat" : "Botão do agente IA oculto no chat");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <CollapsibleSettingsCard
      icon={<Bot size={18} />}
      title="Botão do agente IA no chat"
      description={'Controla se o botão "IA ON/OFF" aparece no canto do cabeçalho da conversa.'}
      contentClassName="flex items-center justify-between gap-4"
    >
        <p className="text-sm text-muted-foreground">
          {enabled
            ? "O botão está visível para ativar/desativar a IA em cada conversa."
            : "O botão está oculto. O modo do agente IA continua como está configurado."}
        </p>
        <Switch
          checked={enabled}
          disabled={save.isPending}
          onCheckedChange={(v) => save.mutate(v)}
          aria-label="Exibir botão do agente IA no chat"
        />
    </CollapsibleSettingsCard>
  );
}
