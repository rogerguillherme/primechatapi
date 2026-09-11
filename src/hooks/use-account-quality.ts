import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useProfile } from "@/hooks/use-profile";

export type QualityRating = "GREEN" | "YELLOW" | "RED" | "UNKNOWN";

export interface AccountQuality {
  account_id: string;
  account_name: string;
  phone: string | null;
  quality_rating: QualityRating;
  messaging_limit_tier: string | null;
  error: string | null;
}

export const QUALITY_LABEL: Record<QualityRating, string> = {
  GREEN: "Alta",
  YELLOW: "Média",
  RED: "Baixa",
  UNKNOWN: "Sem dado",
};

/** Cor de texto/ícone por qualidade — usa tokens semânticos do tema. */
export const QUALITY_TEXT: Record<QualityRating, string> = {
  GREEN: "text-emerald-500",
  YELLOW: "text-amber-500",
  RED: "text-destructive",
  UNKNOWN: "text-muted-foreground",
};

/** Cor de fundo do pontinho ao lado do nome da conta. */
export const QUALITY_DOT: Record<QualityRating, string> = {
  GREEN: "bg-emerald-500",
  YELLOW: "bg-amber-500",
  RED: "bg-destructive",
  UNKNOWN: "bg-muted-foreground/50",
};

const normalize = (v: unknown): QualityRating => {
  const s = String(v || "").toUpperCase();
  return s === "GREEN" || s === "YELLOW" || s === "RED" ? s : "UNKNOWN";
};

/**
 * Qualidade dos números direto da Meta (via edge function whatsapp-limits).
 *
 * A qualidade é o termômetro que antecede o bloqueio: quando cai para média já
 * há reclamação suficiente para valer parar e revisar a mensagem. Por isso ela
 * fica visível no chat e não escondida numa tela de diagnóstico.
 */
export function useAccountQuality() {
  const { session } = useAuth();
  const { profile } = useProfile();

  const showQuality = profile?.antiban_show_quality !== false;
  const enabled = Boolean(session?.access_token) && showQuality;

  const { data, isLoading } = useQuery({
    queryKey: ["account-quality", session?.user.id],
    enabled,
    staleTime: 240_000,
    refetchInterval: enabled ? 300_000 : false,
    retry: 1,
    queryFn: async (): Promise<AccountQuality[]> => {
      const { data, error } = await supabase.functions.invoke("whatsapp-limits");
      if (error) return [];
      return (data?.limits || []).map((l: any) => ({
        account_id: l.account_id,
        account_name: l.account_name,
        phone: l.phone ?? null,
        quality_rating: normalize(l.quality_rating),
        messaging_limit_tier: l.messaging_limit_tier ?? null,
        error: l.error ?? null,
      }));
    },
  });

  const byAccount = new Map<string, AccountQuality>();
  for (const item of data || []) byAccount.set(item.account_id, item);

  const qualityOf = (accountId?: string | null): QualityRating =>
    (accountId && byAccount.get(accountId)?.quality_rating) || "UNKNOWN";

  return {
    list: data || [],
    byAccount,
    qualityOf,
    isLoading,
    showQuality,
    warnMedium: profile?.antiban_warn_medium !== false,
    confirmLow: profile?.antiban_confirm_low !== false,
  };
}
