import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * trial_ends_at is only set for self-signup accounts (/teste-gratis).
 * Admin-created accounts have it NULL and never expire.
 */
export function useTrialStatus() {
  const { user, session } = useAuth();

  const { data: trialEndsAt, isLoading } = useQuery({
    queryKey: ["trial-status", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", user!.id)
        .single();
      if (error) throw error;
      return ((data as Record<string, unknown>)?.trial_ends_at as string | null) ?? null;
    },
    enabled: !!session && !!user,
  });

  const isExpired = !!trialEndsAt && new Date(trialEndsAt) < new Date();

  // `loading` aqui derruba o app inteiro: o ProtectedRoute troca os filhos por
  // um spinner enquanto for true. Isso é certo na primeira vez — ninguém deve
  // ver o app antes de sabermos se o trial venceu. Depois de resolvido uma vez,
  // deixar de ser: qualquer nova consulta pendente desmontaria tudo o que está
  // aberto, e o operador perde a aba, o rascunho e a conversa selecionada.
  // A referência zera quando é outra pessoa, aí o gate volta a valer.
  const jaResolvido = useRef<string | null>(null);
  useEffect(() => {
    if (!isLoading && user?.id) jaResolvido.current = user.id;
  }, [isLoading, user?.id]);

  const primeiraVez = jaResolvido.current !== (user?.id ?? null);

  return { trialEndsAt, isExpired, loading: isLoading && primeiraVez };
}
