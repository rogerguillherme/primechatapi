import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTeamContext, useTeamMembers } from "@/hooks/use-team";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Gauge, Shield } from "lucide-react";

interface AgentStat {
  member_user_id: string;
  total_leads: number;
  leads_today: number;
  response_rate: number;
  avg_response_time_minutes: number;
}

/**
 * Desempenho por atendente: quantos leads cada um tem, quantos chegaram hoje,
 * taxa de resposta e tempo médio.
 *
 * Só faz sentido pra quem enxerga todo mundo — um colaborador com escopo
 * "apenas atribuídos" não vê os leads dos outros nem no banco (RLS), então a
 * tela ficaria com todo mundo zerado exceto ele mesmo. Restringir de propósito
 * evita a confusão de um número parcial parecendo o total da equipe.
 */
export function AgentMetrics() {
  const { data: team } = useTeamContext();
  const canView = !!team?.canManageTeam || team?.leadScope === "all";
  const { data: members = [], isLoading: loadingMembers } = useTeamMembers(canView);

  const { data: stats, isLoading: loadingStats } = useQuery({
    queryKey: ["team-agent-stats", team?.ownerId],
    enabled: canView && !!team?.ownerId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_team_agent_stats", { p_owner_id: team!.ownerId });
      if (error) throw error;
      return (data || []) as unknown as AgentStat[];
    },
    refetchInterval: 60_000,
  });

  if (!canView) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <Shield size={36} className="text-muted-foreground" />
          <p className="font-medium">Acesso restrito</p>
          <p className="text-sm text-muted-foreground max-w-md">
            Só quem enxerga os leads de toda a equipe pode comparar o desempenho entre atendentes.
          </p>
        </CardContent>
      </Card>
    );
  }

  const statsByMember = new Map((stats || []).map((s) => [s.member_user_id, s]));
  const isLoading = loadingMembers || loadingStats;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Gauge size={20} className="text-primary" />
        <div>
          <h2 className="text-lg font-semibold">Atendentes</h2>
          <p className="text-xs text-muted-foreground">
            Leads atribuídos, resposta e tempo médio de cada colaborador
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Atendente</TableHead>
                  <TableHead>Leads atribuídos</TableHead>
                  <TableHead>Hoje</TableHead>
                  <TableHead>Taxa de resposta</TableHead>
                  <TableHead>Tempo médio de resposta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => {
                  const s = statsByMember.get(m.member_user_id);
                  return (
                    <TableRow key={m.member_user_id}>
                      <TableCell className="font-medium">
                        {m.display_name || m.email}
                        {m.access_level === "manager" && m.lead_scope === "all" && m.id.startsWith("owner-") && (
                          <span className="ml-1.5 text-[10px] text-muted-foreground">(dono)</span>
                        )}
                      </TableCell>
                      <TableCell className="tabular-nums">{s?.total_leads ?? 0}</TableCell>
                      <TableCell className="tabular-nums">{s?.leads_today ?? 0}</TableCell>
                      <TableCell className="tabular-nums">{s ? `${s.response_rate}%` : "—"}</TableCell>
                      <TableCell className="tabular-nums">
                        {s && s.avg_response_time_minutes > 0 ? `${s.avg_response_time_minutes} min` : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {members.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                      Nenhum colaborador cadastrado
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
