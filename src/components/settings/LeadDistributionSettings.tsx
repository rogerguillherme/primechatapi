import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTeamMembers } from "@/hooks/use-team";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Loader2, Shuffle, UserCheck, Users } from "lucide-react";

/** Conta autorizada a usar a distribuição inteligente de leads. */
export const LEAD_DISTRIBUTION_EMAIL = "estevaosz0602@gmail.com";

export type DistributionTrigger = "first_inbound" | "any_unassigned" | "lead_created";

const TRIGGERS: Array<{ value: DistributionTrigger; title: string; description: string }> = [
  {
    value: "first_inbound",
    title: "Primeira mensagem recebida",
    description: "Distribui quando o lead responde pela primeira vez.",
  },
  {
    value: "any_unassigned",
    title: "Qualquer mensagem sem responsável",
    description: "Sempre que chegar mensagem de um lead que ainda não tem atendente.",
  },
  {
    value: "lead_created",
    title: "Na criação do lead",
    description: "Distribui assim que o lead entra na base (importação, webhook, disparo).",
  },
];

interface SettingsRow {
  id: string;
  owner_id: string;
  enabled: boolean;
  trigger_mode: DistributionTrigger;
  waiting_stage_id: string | null;
  in_service_stage_id: string | null;
  sticky_agent: boolean;
}

interface TargetRow {
  id: string;
  member_user_id: string;
  weight_percent: number;
  active: boolean;
  assigned_count: number;
}

/** Distribuição inteligente de leads entre colaboradores, com peso percentual. */
export function LeadDistributionSettings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const allowed = user?.email?.toLowerCase() === LEAD_DISTRIBUTION_EMAIL;

  const { data: members } = useTeamMembers(allowed);

  const { data: settings } = useQuery<SettingsRow | null>({
    queryKey: ["lead-distribution-settings", user?.id],
    enabled: allowed && !!user,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("lead_distribution_settings")
        .select("*")
        .eq("owner_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return (data as SettingsRow) ?? null;
    },
  });

  const { data: targets } = useQuery<TargetRow[]>({
    queryKey: ["lead-distribution-targets", user?.id],
    enabled: allowed && !!user,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("lead_distribution_targets")
        .select("*")
        .eq("owner_id", user!.id);
      if (error) throw error;
      return (data as TargetRow[]) || [];
    },
  });

  // Estado local dos pesos (percentual) por colaborador.
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [active, setActive] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!targets) return;
    const w: Record<string, number> = {};
    const a: Record<string, boolean> = {};
    for (const t of targets) {
      w[t.member_user_id] = Number(t.weight_percent) || 0;
      a[t.member_user_id] = t.active;
    }
    setWeights(w);
    setActive(a);
  }, [targets]);

  const totalWeight = useMemo(
    () =>
      Object.entries(weights).reduce(
        (sum, [id, value]) => sum + (active[id] ? Number(value) || 0 : 0),
        0,
      ),
    [weights, active],
  );

  const assignedByMember = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of targets || []) map[t.member_user_id] = t.assigned_count;
    return map;
  }, [targets]);

  const saveSettings = useMutation({
    mutationFn: async (patch: Partial<Pick<SettingsRow, "enabled" | "trigger_mode" | "sticky_agent">>) => {
      if (!user) throw new Error("Usuário não autenticado");
      const { error } = await (supabase as any)
        .from("lead_distribution_settings")
        .upsert({ owner_id: user.id, ...patch }, { onConflict: "owner_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead-distribution-settings", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveTargets = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Usuário não autenticado");
      const rows = (members || []).map((m) => ({
        owner_id: user.id,
        member_user_id: m.member_user_id,
        weight_percent: Math.max(0, Math.min(100, Number(weights[m.member_user_id]) || 0)),
        active: !!active[m.member_user_id],
      }));
      if (!rows.length) throw new Error("Cadastre colaboradores antes de distribuir leads");
      const { error } = await (supabase as any)
        .from("lead_distribution_targets")
        .upsert(rows, { onConflict: "owner_id,member_user_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Distribuição salva");
      queryClient.invalidateQueries({ queryKey: ["lead-distribution-targets", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!allowed) return null;

  const currentTrigger: DistributionTrigger = settings?.trigger_mode || "first_inbound";

  return (
    <Card className="glass-card">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Shuffle size={18} />
              Distribuição inteligente de leads
            </CardTitle>
            <CardDescription>
              Divide automaticamente os leads entre os colaboradores conforme o percentual definido e
              move o lead para “Lead em Atendimento”.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Label htmlFor="dist-enabled" className="text-xs text-muted-foreground">
              {settings?.enabled ? "Ativa" : "Inativa"}
            </Label>
            <Switch
              id="dist-enabled"
              checked={!!settings?.enabled}
              onCheckedChange={(v) => saveSettings.mutate({ enabled: v })}
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label>Quando distribuir</Label>
          <div className="grid gap-2 grid-cols-1 md:grid-cols-3">
            {TRIGGERS.map((t) => {
              const selected = currentTrigger === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => saveSettings.mutate({ trigger_mode: t.value })}
                  className={cn(
                    "text-left rounded-lg border p-3 transition-colors",
                    selected
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-accent/40",
                  )}
                >
                  <p className="text-sm font-medium">{t.title}</p>
                  <p className="text-xs text-muted-foreground mt-1">{t.description}</p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
          <div className="space-y-1">
            <Label htmlFor="dist-sticky" className="flex items-center gap-2">
              <UserCheck size={14} /> Lead que volta fica com o mesmo vendedor
            </Label>
            <p className="text-xs text-muted-foreground">
              Quando um lead perde o responsável e volta a mandar mensagem, ele é devolvido ao último
              vendedor que o atendeu, em vez de entrar no rodízio. Se esse vendedor não estiver mais
              ativo na lista abaixo, o rodízio normal assume. O retorno não conta no total de leads
              recebidos — só leads novos pesam no percentual.
            </p>
          </div>
          <Switch
            id="dist-sticky"
            checked={!!settings?.sticky_agent}
            onCheckedChange={(v) => saveSettings.mutate({ sticky_agent: v })}
          />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <Label className="flex items-center gap-2">
              <Users size={14} /> Percentual por colaborador
            </Label>
            <Badge variant={totalWeight === 100 ? "default" : "secondary"}>
              Total: {totalWeight}%
            </Badge>
          </div>

          {!members?.length && (
            <p className="text-sm text-muted-foreground">
              Nenhum colaborador cadastrado. Adicione colaboradores em Equipe para distribuir leads.
            </p>
          )}

          <div className="space-y-2">
            {(members || []).map((m) => (
              <div
                key={m.member_user_id}
                className="flex items-center gap-3 rounded-lg border border-border p-2.5"
              >
                <Checkbox
                  checked={!!active[m.member_user_id]}
                  onCheckedChange={(v) =>
                    setActive((prev) => ({ ...prev, [m.member_user_id]: !!v }))
                  }
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {m.display_name || m.email}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {m.email} · {assignedByMember[m.member_user_id] || 0} leads recebidos
                  </p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={weights[m.member_user_id] ?? 0}
                    onChange={(e) =>
                      setWeights((prev) => ({
                        ...prev,
                        [m.member_user_id]: Number(e.target.value),
                      }))
                    }
                    className="w-20 h-9 tabular-nums"
                    disabled={!active[m.member_user_id]}
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
              </div>
            ))}
          </div>

          {totalWeight !== 100 && !!members?.length && (
            <p className="text-xs text-muted-foreground">
              O total não precisa ser exatamente 100% — os percentuais são usados de forma
              proporcional entre os colaboradores ativos.
            </p>
          )}

          <div className="flex justify-end">
            <Button
              onClick={() => saveTargets.mutate()}
              disabled={saveTargets.isPending || !members?.length}
              className="gap-2"
            >
              {saveTargets.isPending && <Loader2 size={14} className="animate-spin" />}
              Salvar distribuição
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
