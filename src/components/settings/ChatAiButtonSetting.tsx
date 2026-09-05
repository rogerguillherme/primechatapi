import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useProfile } from "@/hooks/use-profile";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
      queryClient.invalidateQueries({ queryKey: ["profile", user?.id] });
      toast.success(value ? "Botão do agente IA visível no chat" : "Botão do agente IA oculto no chat");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Bot size={18} />
          Botão do agente IA no chat
        </CardTitle>
        <CardDescription>
          Controla se o botão "IA ON/OFF" aparece no canto do cabeçalho da conversa.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-4">
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
      </CardContent>
    </Card>
  );
}
