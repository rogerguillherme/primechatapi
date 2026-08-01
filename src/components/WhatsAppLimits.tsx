import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Gauge, Phone, ShieldCheck, AlertTriangle, Loader2 } from "lucide-react";

const tierLabels: Record<string, string> = {
  TIER_NOT_SET: "Não definido",
  TIER_50: "50 conversas/dia",
  TIER_250: "250 conversas/dia",
  TIER_1K: "1.000 conversas/dia",
  TIER_10K: "10.000 conversas/dia",
  TIER_100K: "100.000 conversas/dia",
  TIER_UNLIMITED: "Ilimitado",
};

const qualityColors: Record<string, string> = {
  GREEN: "text-emerald-500",
  YELLOW: "text-amber-500",
  RED: "text-destructive",
};

const qualityLabels: Record<string, string> = {
  GREEN: "Alta",
  YELLOW: "Média",
  RED: "Baixa",
};

const isUnauthorizedFunctionError = (error: unknown) =>
  error instanceof Error && error.message.includes("401");

export function WhatsAppLimits() {
  const { session } = useAuth();
  const isAuthenticated = Boolean(session?.access_token);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["whatsapp-limits", session?.user.id],
    enabled: isAuthenticated,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("whatsapp-limits");
      if (error) {
        if (isUnauthorizedFunctionError(error)) return [];
        throw error;
      }
      return data?.limits || [];
    },
    refetchInterval: isAuthenticated ? 300000 : false,
    staleTime: 240000,
    retry: 1,
    retryDelay: 3000,
  });

  if (!isAuthenticated) return null;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 size={16} className="animate-spin" /> Consultando limites...
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0 || isError) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Gauge size={16} /> Limites de disparo por número
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-border">
          {data.map((acc: any) => (
            <div key={acc.account_id} className="px-4 py-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Phone size={14} className="text-muted-foreground" />
                  <span className="text-sm font-medium">{acc.account_name}</span>
                  {acc.is_default && (
                    <Badge variant="default" className="text-[10px] px-1.5 py-0">Padrão</Badge>
                  )}
                </div>
                {acc.phone && (
                  <span className="text-xs text-muted-foreground">{acc.phone}</span>
                )}
              </div>

              {acc.error ? (
                <div className="flex items-center gap-1.5 text-xs text-destructive bg-destructive/10 px-2 py-1.5 rounded-md">
                  <AlertTriangle size={12} />
                  <span className="flex-1">
                    {acc.error.includes("session is invalid") || acc.error.includes("access token")
                      ? "Token expirado — reconecte essa conta no Meta"
                      : `Erro: ${acc.error}`}
                  </span>
                  <a
                    href="/whatsapp-api"
                    className="underline font-medium hover:text-destructive/80"
                  >
                    Reconectar
                  </a>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <div className="py-2 px-3 rounded-md bg-muted/50">
                    <p className="text-[10px] text-muted-foreground mb-0.5">Limite</p>
                    <p className="text-sm font-semibold">
                      {tierLabels[acc.messaging_limit_tier] || acc.messaging_limit_tier || "—"}
                    </p>
                  </div>
                  <div className="py-2 px-3 rounded-md bg-muted/50">
                    <p className="text-[10px] text-muted-foreground mb-0.5">Qualidade</p>
                    <div className="flex items-center gap-1.5">
                      <ShieldCheck size={14} className={qualityColors[acc.quality_rating] || "text-muted-foreground"} />
                      <p className={`text-sm font-semibold ${qualityColors[acc.quality_rating] || ""}`}>
                        {qualityLabels[acc.quality_rating] || acc.quality_rating || "—"}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
