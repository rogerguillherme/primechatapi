import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTeamContext, useTeamMembers } from "@/hooks/use-team";
import { PremiumCard } from "@/components/premium/PremiumCard";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Users2 } from "lucide-react";

interface TodayStat {
  member_user_id: string;
  leads_today: number;
  messages_sent_today: number;
  replies_today: number;
  sales_today: number;
  revenue_today: number;
}

const moeda = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/**
 * Desempenho de HOJE por vendedor, na tela inicial.
 *
 * A aba de equipe já mostra o acumulado; quem abre o painel de manhã quer
 * saber o que está acontecendo agora — por isso aqui é só o dia corrente, e
 * atualiza sozinho a cada minuto.
 *
 * Só aparece para quem enxerga a equipe inteira: com escopo "apenas
 * atribuídos" o RLS esconde os leads dos outros, e a tabela mostraria todo
 * mundo zerado — um número parcial parecendo o total confunde mais que ajuda.
 */
export function TeamTodayPanel() {
  const { data: team } = useTeamContext();
  const canView = !!team?.canManageTeam || team?.leadScope === "all";
  const { data: members = [], isLoading: loadingMembers } = useTeamMembers(canView);

  const { data: stats, isLoading: loadingStats } = useQuery({
    queryKey: ["team-today-stats", team?.ownerId],
    enabled: canView && !!team?.ownerId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_team_today_stats", {
        p_owner_id: team!.ownerId,
      });
      if (error) throw error;
      return (data || []) as TodayStat[];
    },
    refetchInterval: 60_000,
  });

  // Um time de uma pessoa não tem nada para comparar.
  if (!canView || (!loadingMembers && members.length <= 1)) return null;

  const porMembro = new Map((stats || []).map((s) => [s.member_user_id, s]));
  const isLoading = loadingMembers || loadingStats;

  const linhas = members
    .map((m) => ({ membro: m, s: porMembro.get(m.member_user_id) }))
    .sort((a, b) => (b.s?.leads_today ?? 0) - (a.s?.leads_today ?? 0));

  const totais = (stats || []).reduce(
    (acc, s) => ({
      leads: acc.leads + Number(s.leads_today || 0),
      msgs: acc.msgs + Number(s.messages_sent_today || 0),
      replies: acc.replies + Number(s.replies_today || 0),
      vendas: acc.vendas + Number(s.sales_today || 0),
      receita: acc.receita + Number(s.revenue_today || 0),
    }),
    { leads: 0, msgs: 0, replies: 0, vendas: 0, receita: 0 },
  );

  return (
    <PremiumCard className="p-0 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/60">
        <Users2 size={18} className="text-primary" />
        <div>
          <h2 className="text-sm font-semibold">Vendedores hoje</h2>
          <p className="text-xs text-muted-foreground">
            Contatos recebidos, mensagens enviadas, respostas e vendas do dia
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Vendedor</TableHead>
              <TableHead className="text-right">Contatos</TableHead>
              <TableHead className="text-right">Enviadas</TableHead>
              <TableHead className="text-right">Responderam</TableHead>
              <TableHead className="text-right">Vendas</TableHead>
              <TableHead className="text-right">Faturamento</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.map(({ membro, s }) => (
              <TableRow key={membro.member_user_id}>
                <TableCell className="font-medium">
                  {membro.display_name || membro.email}
                </TableCell>
                <TableCell className="text-right tabular-nums">{s?.leads_today ?? 0}</TableCell>
                <TableCell className="text-right tabular-nums">{s?.messages_sent_today ?? 0}</TableCell>
                <TableCell className="text-right tabular-nums">{s?.replies_today ?? 0}</TableCell>
                <TableCell className="text-right tabular-nums">{s?.sales_today ?? 0}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {moeda(Number(s?.revenue_today ?? 0))}
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-muted/40 font-semibold">
              <TableCell>Total</TableCell>
              <TableCell className="text-right tabular-nums">{totais.leads}</TableCell>
              <TableCell className="text-right tabular-nums">{totais.msgs}</TableCell>
              <TableCell className="text-right tabular-nums">{totais.replies}</TableCell>
              <TableCell className="text-right tabular-nums">{totais.vendas}</TableCell>
              <TableCell className="text-right tabular-nums">{moeda(totais.receita)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )}
    </PremiumCard>
  );
}
