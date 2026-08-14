import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useProfile } from "@/hooks/use-profile";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Home, Send, HeartHandshake, Loader2 } from "lucide-react";

export type HomeView = "broadcast" | "service";

const OPTIONS: Array<{
  value: HomeView;
  title: string;
  description: string;
  icon: typeof Send;
}> = [
  {
    value: "broadcast",
    title: "Dados de disparo",
    description: "Envios em tempo real, campanhas, entregas, erros e gasto por número.",
    icon: Send,
  },
  {
    value: "service",
    title: "Atendimento e vendas",
    description: "Conversas, respostas, taxa de atendimento, pedidos e ranking de vendas.",
    icon: HeartHandshake,
  },
];

/** Permite ao cliente escolher o que a aba Início exibe. */
export function HomeViewSetting() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const queryClient = useQueryClient();

  const current: HomeView = (profile?.home_view as HomeView) || "broadcast";

  const save = useMutation({
    mutationFn: async (value: HomeView) => {
      if (!user) throw new Error("Usuário não autenticado");
      const { error } = await supabase
        .from("profiles")
        .update({ home_view: value } as never)
        .eq("user_id", user.id);
      if (error) throw error;
      return value;
    },
    onSuccess: (value) => {
      queryClient.invalidateQueries({ queryKey: ["profile", user?.id] });
      toast.success(
        value === "broadcast"
          ? "Início agora mostra os dados de disparo"
          : "Início agora mostra métricas de atendimento e vendas",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Home size={18} />
          Tela inicial
        </CardTitle>
        <CardDescription>Escolha quais informações aparecem na aba Início.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        {OPTIONS.map((opt) => {
          const active = current === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => !active && save.mutate(opt.value)}
              disabled={save.isPending}
              className={cn(
                "text-left rounded-xl border p-4 transition-all hover:border-primary/60",
                active ? "border-primary bg-primary/5 shadow-sm" : "border-border bg-card",
              )}
            >
              <div className="flex items-center gap-2">
                <opt.icon size={16} className={active ? "text-primary" : "text-muted-foreground"} />
                <span className="font-medium text-sm">{opt.title}</span>
                {save.isPending && save.variables === opt.value && (
                  <Loader2 size={13} className="animate-spin text-muted-foreground" />
                )}
                {active && <span className="ml-auto text-[10px] font-semibold text-primary">ATIVO</span>}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">{opt.description}</p>
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}
