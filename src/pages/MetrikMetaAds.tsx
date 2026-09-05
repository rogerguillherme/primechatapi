import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { DollarSign, TrendingUp, Users, Target } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useMetrikData } from "@/hooks/use-metrik-data";
import { useMetrikPeriodo } from "@/hooks/use-metrik-periodo";
import { SeletorPeriodo } from "@/components/metrics/SeletorPeriodo";
import { useFavicon } from "@/hooks/use-favicon";
import { Card, Kpi, TituloPagina, Vazio, Barra, moeda } from "@/components/metrics/ui";
import { roas, roi } from "../../supabase/functions/_shared/metrics-engine.mjs";

/**
 * Meta Ads: o dinheiro que entra confrontado com o que foi gasto para trazê-lo.
 *
 * O investimento sai dos lançamentos em `metrics_ad_spend` — nada é estimado.
 * Quando não há lançamento no período, os indicadores derivados aparecem como
 * "—" em vez de zero: zero diria que o retorno foi nulo, quando o que houve foi
 * ausência de gasto informado.
 */
export default function MetrikMetaAds() {
  useFavicon("/metrik-favicon.svg");

  const { inicio, fim } = useMetrikPeriodo();
  const { ownerId, totais, vendedores } = useMetrikData(inicio, fim);

  /** Leads do período: base do CPL. */
  const { data: leads = 0 } = useQuery({
    queryKey: ["metrik-ads-leads", ownerId, inicio.toISOString(), fim.toISOString()],
    enabled: !!ownerId,
    queryFn: async () => {
      const { count, error } = await (supabase as any)
        .from("leads")
        .select("id", { count: "exact", head: true })
        .gte("created_at", inicio.toISOString())
        .lte("created_at", fim.toISOString());
      if (error) throw error;
      return count || 0;
    },
  });

  const { data: lancamentos = [] } = useQuery({
    queryKey: ["metrik-ads-lancamentos", ownerId, inicio.toISOString(), fim.toISOString()],
    enabled: !!ownerId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("metrics_ad_spend")
        .select("id, amount, period_start, period_end, member_user_id, source")
        .eq("owner_id", ownerId)
        .lte("period_start", format(fim, "yyyy-MM-dd"))
        .gte("period_end", format(inicio, "yyyy-MM-dd"))
        .order("period_start", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const investido = totais.investimento;
  const ro = roas(totais.faturamento, investido) as number | null;
  const r = roi(totais.faturamento, investido) as number | null;
  const cpl = investido > 0 && leads > 0 ? investido / leads : null;
  const cpa = investido > 0 && totais.vendas > 0 ? investido / totais.vendas : null;

  const nomePor = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of vendedores) if (v.userId) m.set(v.userId, v.nome);
    return m;
  }, [vendedores]);

  const comGasto = vendedores.filter((v) => v.investimento > 0 || v.faturamento > 0);
  const maiorFat = Math.max(1, ...comGasto.map((v) => v.faturamento));

  return (
    <div className="space-y-6">
      <TituloPagina
        titulo="Meta Ads"
        sub="Investimento em anúncio confrontado com o faturamento do período"
      />

      <SeletorPeriodo />

      <div className="metrik-glow grid gap-4 rounded-xl sm:grid-cols-2 xl:grid-cols-4">
        <Kpi rotulo="Investido" valor={moeda(investido)} nota="lançado no período" icone={DollarSign} destaque />
        <Kpi
          rotulo="ROAS"
          valor={ro === null ? "—" : `${ro.toFixed(2)}x`}
          nota={ro === null ? "sem investimento lançado" : "retorno por real gasto"}
          icone={TrendingUp}
        />
        <Kpi
          rotulo="CPL"
          valor={cpl === null ? "—" : moeda(cpl)}
          nota={`${leads} lead(s) no período`}
          icone={Users}
        />
        <Kpi
          rotulo="CPA"
          valor={cpa === null ? "—" : moeda(cpa)}
          nota={`${totais.vendas} venda(s) aprovada(s)`}
          icone={Target}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi rotulo="Faturamento" valor={moeda(totais.faturamento)} icone={DollarSign} />
        <Kpi
          rotulo="Lucro"
          valor={moeda(totais.lucro)}
          nota="líquido menos investimento"
          icone={TrendingUp}
          tom={totais.lucro < 0 ? "text-destructive" : undefined}
        />
        <Kpi
          rotulo="ROI"
          valor={r === null ? "—" : `${(r * 100).toFixed(0)}%`}
          nota={r === null ? "sem investimento lançado" : "lucro sobre o investido"}
          icone={TrendingUp}
          tom={r !== null && r < 0 ? "text-destructive" : undefined}
        />
      </div>

      <Card>
        <h2 className="font-semibold">Retorno por vendedor</h2>
        <p className="text-xs text-muted-foreground">
          Gasto atribuído a cada um contra o que ele trouxe
        </p>

        {comGasto.length === 0 ? (
          <div className="mt-3">
            <Vazio>Nenhum gasto ou venda no período.</Vazio>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {comGasto.map((v) => {
              const rv = roas(v.faturamento, v.investimento) as number | null;
              return (
                <div key={v.userId || v.nome} className="space-y-1.5">
                  <div className="flex flex-wrap items-baseline gap-2 text-sm">
                    <span className="font-medium">{v.nome}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      gasto {moeda(v.investimento)}
                    </span>
                    <span className="ml-auto tabular-nums">{moeda(v.faturamento)}</span>
                    <span className="w-16 text-right text-xs tabular-nums text-primary">
                      {rv === null ? "—" : `${rv.toFixed(2)}x`}
                    </span>
                  </div>
                  <Barra valor={v.faturamento / maiorFat} />
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card>
        <h2 className="font-semibold">Lançamentos de gasto</h2>
        <p className="text-xs text-muted-foreground">
          O que foi informado em Ajustes › Investimento em anúncio
        </p>

        {lancamentos.length === 0 ? (
          <div className="mt-3">
            <Vazio>
              Nenhum gasto lançado neste período — sem ele, CPL, CPA, ROAS e ROI não têm
              como ser calculados.
            </Vazio>
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="py-2 text-left font-medium">Período</th>
                  <th className="py-2 text-left font-medium">Atribuição</th>
                  <th className="py-2 text-left font-medium">Origem</th>
                  <th className="py-2 text-right font-medium">Valor</th>
                </tr>
              </thead>
              <tbody>
                {(lancamentos as any[]).map((l) => (
                  <tr key={l.id} className="border-b border-border/50 last:border-0">
                    <td className="py-2 tabular-nums">
                      {format(new Date(`${l.period_start}T12:00:00`), "dd/MM")} –{" "}
                      {format(new Date(`${l.period_end}T12:00:00`), "dd/MM")}
                    </td>
                    <td className="py-2">
                      {l.member_user_id ? nomePor.get(l.member_user_id) || "Vendedor" : "Empresa"}
                    </td>
                    <td className="py-2 text-muted-foreground">{l.source || "manual"}</td>
                    <td className="py-2 text-right tabular-nums">{moeda(Number(l.amount) || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
