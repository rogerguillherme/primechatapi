import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useProfile } from "@/hooks/use-profile";
import {
  useAccountQuality,
  QUALITY_LABEL,
  QUALITY_TEXT,
  QUALITY_DOT,
} from "@/hooks/use-account-quality";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ShieldCheck, Gauge, AlertTriangle, ShieldAlert, Loader2 } from "lucide-react";

type Flag = "antiban_show_quality" | "antiban_warn_medium" | "antiban_confirm_low";

/**
 * Controle Anti-ban.
 *
 * Qualidade caindo é o único aviso que a Meta dá antes de limitar ou banir o
 * número. Deixar isso visível no chat — e obrigar uma confirmação quando já
 * está baixa — evita que a equipe continue disparando no número que está
 * afundando sem perceber.
 */
export function AntiBanSettings() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const queryClient = useQueryClient();
  const { list, isLoading } = useAccountQuality();

  const showQuality = profile?.antiban_show_quality !== false;
  const warnMedium = profile?.antiban_warn_medium !== false;
  const confirmLow = profile?.antiban_confirm_low !== false;

  const save = useMutation({
    mutationFn: async ({ field, value }: { field: Flag; value: boolean }) => {
      if (!user) throw new Error("Usuário não autenticado");
      const { error } = await supabase
        .from("profiles")
        .update({ [field]: value } as never)
        .eq("user_id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile", user?.id] });
      toast.success("Preferência salva");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows: { field: Flag; icon: JSX.Element; title: string; desc: string; value: boolean }[] = [
    {
      field: "antiban_show_quality",
      icon: <Gauge size={16} className="text-primary mt-0.5" />,
      title: "Mostrar qualidade do número",
      desc: "Exibe no chat, ao lado do número que está atendendo, a qualidade informada pela Meta (Alta, Média ou Baixa).",
      value: showQuality,
    },
    {
      field: "antiban_warn_medium",
      icon: <AlertTriangle size={16} className="text-amber-500 mt-0.5" />,
      title: "Avisar quando a qualidade estiver média",
      desc: "Mostra um aviso amarelo ao enviar por um número com qualidade média. O envio continua normalmente.",
      value: warnMedium,
    },
    {
      field: "antiban_confirm_low",
      icon: <ShieldAlert size={16} className="text-destructive mt-0.5" />,
      title: "Pedir confirmação quando a qualidade estiver baixa",
      desc: "Antes de enviar por um número com qualidade baixa, abre um aviso pedindo um OK para continuar.",
      value: confirmLow,
    },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck size={18} />
            Controle Anti-ban
          </CardTitle>
          <CardDescription>
            Avisos automáticos para não continuar disparando por um número que a Meta já está
            penalizando.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {rows.map((r) => (
            <div
              key={r.field}
              className="flex items-start justify-between gap-4 rounded-lg border border-border p-3"
            >
              <div className="flex items-start gap-2">
                {r.icon}
                <div>
                  <Label className="text-sm font-medium">{r.title}</Label>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                    {r.desc}
                  </p>
                </div>
              </div>
              <Switch
                checked={r.value}
                disabled={save.isPending}
                onCheckedChange={(v) => save.mutate({ field: r.field, value: v })}
                aria-label={r.title}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Gauge size={16} /> Qualidade atual dos seus números
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-6 flex items-center justify-center gap-2 text-muted-foreground text-sm">
              <Loader2 size={16} className="animate-spin" /> Consultando a Meta...
            </div>
          ) : list.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              {showQuality
                ? "Nenhum número com qualidade informada pela Meta no momento."
                : "Ative “Mostrar qualidade do número” para consultar a Meta."}
            </p>
          ) : (
            <div className="divide-y divide-border">
              {list.map((acc) => (
                <div key={acc.account_id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{acc.account_name}</p>
                    <p className="text-xs text-muted-foreground">{acc.phone || "—"}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={cn("w-2 h-2 rounded-full", QUALITY_DOT[acc.quality_rating])} />
                    <span className={cn("text-sm font-semibold", QUALITY_TEXT[acc.quality_rating])}>
                      {QUALITY_LABEL[acc.quality_rating]}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
