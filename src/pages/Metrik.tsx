import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowLeft, Trophy, Target, TrendingUp, Users, Loader2, Megaphone } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTeamContext, useTeamMembers } from "@/hooks/use-team";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { MetrikSettings } from "@/components/metrics/MetrikSettings";
import {
  eloAtual,
  proximoElo,
  progressoNoElo,
  comissao,
  progressoMeta,
  roas,
  roi,
} from "../../supabase/functions/_shared/metrics-engine.mjs";

/**
 * Metrik — performance comercial com elos, metas e comissão.
 *
 * Nada de venda é gravado aqui. Faturamento, elo e comissão saem de `orders`
 * na leitura: número guardado em dois lugares é número que diverge, e comissão
 * divergente é briga com o vendedor.
 *
 * O vendedor de uma venda é quem atende o lead (`leads.assigned_to`) — é assim
 * que o CRM já funciona, e inventar outra atribuição criaria duas verdades.
 */

const moeda = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

interface Tier {
  id: string;
  name: string;
  min_value: number;
  commission_pct: number;
  color: string;
}

interface LinhaVendedor {
  userId: string | null;
  nome: string;
  faturamento: number;
  vendas: number;
}

export default function Metrik() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: team } = useTeamContext();
  const ownerId = team?.ownerId ?? user?.id ?? null;
  const podeConfigurar = !team || team.accessLevel === "owner" || team.accessLevel === "manager";

  const [mes] = useState(() => new Date());

  // Com ou sem ROI/ROAS.
  //
  // Nem toda operação anuncia, e para quem não anuncia essas colunas só ocupam
  // espaço e confundem — o gasto é zero, o indicador não se aplica, e uma
  // coluna de traços passa a impressão de que algo está quebrado. A escolha
  // fica com quem olha, e é lembrada.
  const [comAds, setComAds] = useState(() => {
    try {
      return localStorage.getItem("prime-metrics:com-ads") === "1";
    } catch {
      return false;
    }
  });
  const alternarAds = (v: boolean) => {
    setComAds(v);
    try {
      localStorage.setItem("prime-metrics:com-ads", v ? "1" : "0");
    } catch {
      /* navegador sem storage: a escolha vale só nesta sessão */
    }
  };
  const inicio = useMemo(() => startOfMonth(mes), [mes]);
  const fim = useMemo(() => endOfMonth(mes), [mes]);

  // ── Elos configurados pela empresa ──
  const { data: tiers = [] } = useQuery({
    queryKey: ["metrics-tiers", ownerId],
    enabled: !!ownerId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("metrics_tiers")
        .select("id, name, min_value, commission_pct, color")
        .eq("owner_id", ownerId)
        .order("min_value");
      if (error) throw error;
      return (data || []) as Tier[];
    },
  });

  // ── Temporada e meta coletiva do período ──
  const { data: temporada } = useQuery({
    queryKey: ["metrics-season", ownerId, inicio.toISOString()],
    enabled: !!ownerId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("metrics_seasons")
        .select("name, starts_at, ends_at")
        .eq("owner_id", ownerId)
        .lte("starts_at", format(fim, "yyyy-MM-dd"))
        .gte("ends_at", format(inicio, "yyyy-MM-dd"))
        .order("starts_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as { name: string } | null;
    },
  });

  const { data: metaColetiva } = useQuery({
    queryKey: ["metrics-goal", ownerId, inicio.toISOString()],
    enabled: !!ownerId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("metrics_goals")
        .select("target_value")
        .eq("owner_id", ownerId)
        .eq("scope", "coletiva")
        .lte("period_start", format(fim, "yyyy-MM-dd"))
        .gte("period_end", format(inicio, "yyyy-MM-dd"))
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data?.target_value != null ? Number(data.target_value) : null;
    },
  });

  // ── Vendas do período, já atribuídas ao vendedor pelo lead ──
  const { data: linhas = [], isLoading, error: erroVendas } = useQuery({
    queryKey: ["metrics-sales", ownerId, inicio.toISOString()],
    enabled: !!ownerId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("orders")
        .select("amount, created_at, leads!inner(assigned_to, user_id)")
        .eq("status", "approved")
        .gte("created_at", inicio.toISOString())
        .lte("created_at", fim.toISOString())
        .limit(5000);
      if (error) throw error;

      const porVendedor = new Map<string, LinhaVendedor>();
      for (const o of data || []) {
        const dono = (o as any).leads?.assigned_to ?? null;
        // Venda sem atendente é o "não atribuído" do plano: some do ranking se
        // for descartada, e some do faturamento se for ignorada. Fica visível.
        const chave = dono || "__sem_atribuicao__";
        const linha = porVendedor.get(chave) || {
          userId: dono,
          nome: "",
          faturamento: 0,
          vendas: 0,
        };
        linha.faturamento += Number((o as any).amount) || 0;
        linha.vendas += 1;
        porVendedor.set(chave, linha);
      }
      return [...porVendedor.values()];
    },
  });

  // ── Gasto em anúncio do período ──
  // Só é consultado quando a visão com ROI/ROAS está ligada: quem não anuncia
  // não paga uma consulta a cada abertura da tela.
  const { data: gastos = [] } = useQuery({
    queryKey: ["metrics-ad-spend", ownerId, inicio.toISOString()],
    enabled: !!ownerId && comAds,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("metrics_ad_spend")
        .select("member_user_id, amount")
        .eq("owner_id", ownerId)
        .lte("period_start", format(fim, "yyyy-MM-dd"))
        .gte("period_end", format(inicio, "yyyy-MM-dd"));
      if (error) throw error;
      return data || [];
    },
  });

  const gastoPor = useMemo(() => {
    const m = new Map<string, number>();
    let empresa = 0;
    for (const g of gastos as any[]) {
      const v = Number(g.amount) || 0;
      if (g.member_user_id) m.set(g.member_user_id, (m.get(g.member_user_id) || 0) + v);
      else empresa += v;
    }
    return { porVendedor: m, empresa };
  }, [gastos]);

  // Os nomes vêm da mesma API que a tela de equipe usa. Consultar team_members
  // direto daqui daria outra lista, com outras regras de acesso — duas verdades
  // sobre quem é vendedor é o começo de um ranking que ninguém confia.
  const { data: membros = [] } = useTeamMembers();

  const nomePor = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of membros) {
      m.set(x.member_user_id, x.display_name || x.email || "Vendedor");
    }
    return m;
  }, [membros]);

  const ranking = useMemo(
    () =>
      [...linhas]
        .map((l) => ({
          ...l,
          nome: l.userId ? nomePor.get(l.userId) || "Vendedor" : "Sem atribuição",
        }))
        .sort((a, b) => b.faturamento - a.faturamento),
    [linhas, nomePor],
  );

  const faturamentoTotal = ranking.reduce((s, l) => s + l.faturamento, 0);
  const vendasTotal = ranking.reduce((s, l) => s + l.vendas, 0);
  const comissaoTotal = ranking
    .filter((l) => l.userId)
    .reduce((s, l) => s + (comissao(l.faturamento, tiers) as number), 0);
  const progColetiva = progressoMeta(faturamentoTotal, metaColetiva ?? 0) as number | null;

  const gastoTotal = comAds
    ? gastoPor.empresa + [...gastoPor.porVendedor.values()].reduce((s, v) => s + v, 0)
    : 0;
  const roasTotal = comAds ? (roas(faturamentoTotal, gastoTotal) as number | null) : null;
  const roiTotal = comAds ? (roi(faturamentoTotal, gastoTotal) as number | null) : null;

  /** "não se aplica" é uma resposta; um número inventado no lugar dela não é. */
  const mostraIndice = (v: number | null, sufixo: string) =>
    v === null ? "—" : `${v.toFixed(2)}${sufixo}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
          <ArrowLeft size={18} />
        </Button>
        <div>
          <h1 className="text-2xl font-display font-bold">Metrik</h1>
          <p className="text-sm text-muted-foreground">
            {temporada?.name ||
              `Temporada de ${format(mes, "MMMM 'de' yyyy", { locale: ptBR })}`}
          </p>
        </div>

        {/* Configurar só para quem manda na conta: o vendedor vê o ranking —
            é o ponto da gamificação — mas não mexe no próprio corte de elo. */}
        {ownerId && podeConfigurar && (
          <div className="ml-auto">
            <MetrikSettings
              ownerId={ownerId}
              tiers={tiers}
              inicio={inicio}
              fim={fim}
              metaAtual={metaColetiva ?? null}
              membros={membros}
            />
          </div>
        )}

        <div className={cn("flex rounded-lg border border-border p-0.5", !podeConfigurar && "ml-auto")}>
          {[
            { valor: false, rotulo: "Sem ROI/ROAS" },
            { valor: true, rotulo: "Com ROI/ROAS" },
          ].map((op) => (
            <button
              key={op.rotulo}
              type="button"
              onClick={() => alternarAds(op.valor)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                comAds === op.valor
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {op.rotulo}
            </button>
          ))}
        </div>
      </div>

      {/* ── Meta coletiva ── */}
      <Card>
        <CardContent className="pt-5 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-sm font-medium">
              <Target size={15} className="text-muted-foreground" /> Meta coletiva
            </span>
            <span className="text-sm tabular-nums">
              {moeda(faturamentoTotal)}
              {metaColetiva ? (
                <span className="text-muted-foreground"> de {moeda(metaColetiva)}</span>
              ) : null}
            </span>
          </div>
          {progColetiva === null ? (
            // Meta zero não é 100%: é meta não definida, e a tela diz isso em
            // vez de mostrar uma barra cheia que ninguém conquistou.
            <p className="text-xs text-muted-foreground">
              Nenhuma meta coletiva definida para este período.
            </p>
          ) : (
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${progColetiva * 100}%` }}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── KPIs ── */}
      <div className={cn("grid gap-3", comAds ? "sm:grid-cols-3 lg:grid-cols-6" : "sm:grid-cols-3")}>
        {[
          { rotulo: "Faturamento", valor: moeda(faturamentoTotal), icone: TrendingUp },
          { rotulo: "Vendas aprovadas", valor: String(vendasTotal), icone: Trophy },
          { rotulo: "Comissão do período", valor: moeda(comissaoTotal), icone: Users },
          ...(comAds
            ? [
                { rotulo: "Investido em anúncio", valor: moeda(gastoTotal), icone: Megaphone },
                { rotulo: "ROAS", valor: mostraIndice(roasTotal, "x"), icone: TrendingUp },
                {
                  rotulo: "ROI",
                  valor: roiTotal === null ? "—" : `${(roiTotal * 100).toFixed(0)}%`,
                  icone: TrendingUp,
                },
              ]
            : []),
        ].map((k) => (
          <Card key={k.rotulo}>
            <CardContent className="pt-5">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <k.icone size={13} /> {k.rotulo}
              </div>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{k.valor}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Ranking ── */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold">Ranking</h2>

        {isLoading && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" /> Somando as vendas do período…
          </p>
        )}

        {erroVendas && (
          <p className="text-sm text-destructive">
            Não foi possível carregar as vendas:{" "}
            {(erroVendas as { message?: string })?.message || String(erroVendas)}
          </p>
        )}

        {!isLoading && !erroVendas && ranking.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhuma venda aprovada neste período.
          </p>
        )}

        {comAds && gastoTotal === 0 && ranking.length > 0 && (
          <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Nenhum gasto de anúncio cadastrado neste período, então ROI e ROAS aparecem como
            <b> —</b>. Não é erro: sem investimento não existe retorno sobre investimento.
            Lance o valor em <b>metrics_ad_spend</b> para os índices ganharem sentido.
          </p>
        )}

        {tiers.length === 0 && ranking.length > 0 && (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            Nenhum elo cadastrado ainda — o ranking mostra faturamento, mas sem elo não há
            comissão a calcular. Cadastre os cortes em <b>metrics_tiers</b> para ligar a
            gamificação.
          </p>
        )}

        {ranking.map((l, i) => {
          const elo = l.userId ? (eloAtual(tiers, l.faturamento) as Tier | null) : null;
          const prox = l.userId
            ? (proximoElo(tiers, l.faturamento) as { tier: Tier; falta: number } | null)
            : null;
          const prog = l.userId ? (progressoNoElo(tiers, l.faturamento) as number) : 0;
          const com = l.userId ? (comissao(l.faturamento, tiers) as number) : 0;

          // Só o gasto ATRIBUÍDO ao vendedor entra aqui. Ratear o gasto da
          // empresa entre todos daria a cada um um ROAS que ele não construiu,
          // e ranking com número emprestado não se sustenta numa conversa.
          const gastoDoVendedor = l.userId ? gastoPor.porVendedor.get(l.userId) || 0 : 0;
          const roasVendedor = comAds
            ? (roas(l.faturamento, gastoDoVendedor) as number | null)
            : null;
          const roiVendedor = comAds
            ? (roi(l.faturamento, gastoDoVendedor) as number | null)
            : null;

          return (
            <Card key={l.userId || "sem"} className={cn(!l.userId && "border-dashed")}>
              <CardContent className="pt-4 space-y-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold tabular-nums text-muted-foreground w-5">
                    {l.userId ? `${i + 1}º` : "—"}
                  </span>
                  <span className="font-medium">{l.nome}</span>
                  {elo && (
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
                      style={{ backgroundColor: elo.color }}
                    >
                      {elo.name}
                    </span>
                  )}
                  <span className="ml-auto text-sm font-semibold tabular-nums">
                    {moeda(l.faturamento)}
                  </span>
                </div>

                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>{l.vendas} venda(s)</span>
                  {l.userId && elo && <span>Comissão {moeda(com)}</span>}
                  {comAds && l.userId && (
                    <>
                      <span>Ads {moeda(gastoDoVendedor)}</span>
                      {/* Traço, não zero: sem gasto atribuído o índice não se
                          aplica, e um "0.00x" faria parecer desempenho ruim. */}
                      <span>ROAS {mostraIndice(roasVendedor, "x")}</span>
                      <span>
                        ROI {roiVendedor === null ? "—" : `${(roiVendedor * 100).toFixed(0)}%`}
                      </span>
                    </>
                  )}
                  {l.userId && prox && (
                    <span>
                      Faltam {moeda(prox.falta)} para {prox.tier.name}
                    </span>
                  )}
                  {!l.userId && (
                    <span className="text-amber-700 dark:text-amber-500">
                      Vendas sem atendente responsável — não entram em comissão até serem
                      atribuídas no CRM.
                    </span>
                  )}
                </div>

                {l.userId && tiers.length > 0 && (
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${prog * 100}%`,
                        backgroundColor: elo?.color || "hsl(var(--primary))",
                      }}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </section>
    </div>
  );
}
