import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface NotificationPrefs {
  new_lead: boolean;
  new_message: boolean;
  assigned_to_me: boolean;
  sound: boolean;
}

/** Tudo ligado: é o mesmo padrão da tabela, para quem nunca abriu a tela. */
export const DEFAULT_PREFS: NotificationPrefs = {
  new_lead: true,
  new_message: true,
  assigned_to_me: true,
  sound: true,
};

export function useNotificationPrefs() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery<NotificationPrefs>({
    queryKey: ["notification-prefs", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("notification_prefs")
        .select("new_lead, new_message, assigned_to_me, sound")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return (data as NotificationPrefs) ?? DEFAULT_PREFS;
    },
    staleTime: 5 * 60_000,
  });

  const save = useMutation({
    mutationFn: async (patch: Partial<NotificationPrefs>) => {
      if (!user) throw new Error("Sessão expirada");
      const { error } = await (supabase as any)
        .from("notification_prefs")
        .upsert({ user_id: user.id, ...query.data, ...patch }, { onConflict: "user_id" });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notification-prefs", user?.id] }),
  });

  return { prefs: query.data ?? DEFAULT_PREFS, isLoading: query.isLoading, save };
}
