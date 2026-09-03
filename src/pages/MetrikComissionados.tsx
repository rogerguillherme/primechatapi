import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  DollarSign, Megaphone, RotateCcw, TrendingUp, Wallet, PiggyBank, Percent,
} from "lucide-react";

import { useMetrikData } from "@/hooks/use-metrik-data";
import { useMetrikPeriodo } from "@/hooks/use-metrik-periodo";
import { SeletorPeriodo } from "@/components/metrics/SeletorPeriodo";
import { useFavicon } from "@/hooks/use-favicon";
import { Card, Kpi, TituloPagina, Vazio, moeda } from "@/components/metrics/ui";
import { HistoricoCiclos } from "@/components/metrics/HistoricoCiclos";
import { cn } from "@/lib/utils";
import {
  eloAtual, baseComissao, comissaoSobreBase, bonusElo, roi,
} from "../../supabase/functions/_shared/metrics-engine.mjs";

/**
 * Comissionados: o fechamento do ciclo.
 *
 * A conta que interessa ao dono da operação é a última linha: o que sobra
 * depois de pagar todo mundo. Ela aparece inteira, com cada parcela visível,
 * porque comissão que não fecha com o extrato vira discussão — e discussão
 * sobre dinheiro custa mais caro que qualquer tela.
 */
export default function MetrikComissionados() {
  useFavicon("/metrik-favicon.svg");

  const { inicio, fim } = useMetrikPeriodo();
  const { vendedores, totais, tiers, config, ownerId } = useMetrikData(inicio, fim);
  const [aba, setAba] = useState<"atual" | "historico">("atual");

  const linhas = useMemo(
    () =>
      vendedores
        .filter((v) => v.userId)
        .map((v) => {
          // A conta, em ordem: tira o que voltou, tira a taxa que a plataforma
          // reteve, e só então aplica o percentual. Comissionar sobre o bruto
          // pagaria o vendedor por dinheiro que a empresa não recebeu.
          const base = baseComissao(v.faturamento, v.reembolsos, config.taxaPct) as number;
          const bonus = bonusElo(tiers, v.faturamento) as number;
          return {
            ...v,
            elo: eloAtual(tiers, v.faturamento) as any,
            base,
            taxa:
              Math.round((v.faturamento - v.reembolsos) * (config.taxaPct / 100) * 100) / 100,
            bonus,
            // O bônus é um valor fixo por ter alcançado o elo, somado ao
            // percentual — não substitui a comissão calculada sobre a base.
            comissao: (comissaoSobreBase(base, tiers, v.faturamento, config.comissaoPct) as number) + bonus,
            roi: roi(v.faturamento, v.investimento) as number | null,
          };
        })
        .sort((a, b) => b.comissao - a.comissao),
    [vendedores, tiers, config],
  );

  const comissaoTotal = linhas.reduce((s, l) => s + l.comissao, 0);
  const taxaTotal = linhas.reduce((s, l) => s + (l.taxa > 0 ? l.taxa : 0), 0);
  const lucroBruto = totais.faturamento - totais.reembolsos - taxaTotal - totais.investimento;
  const lucroLiquido = lucroBruto - comissaoTotal;

  return (
    <div className="space-y-6">
      <TituloPagina
        titulo="Comissionados"
        sub={`Ciclo de ${format(inicio, "dd/MM")} a ${format(fim, "dd/MM 'de' yyyy", { locale: ptBR })}`}
      />

      {/* Atual e Histórico como abas: são a mesma pergunta em recortes
          diferentes — "quanto pagar agora" e "como isso vem se comportando" —
          e separá-las em telas faria a segunda nunca ser aberta. */}
      <div className="flex rounded-lg border border-border p-0.5 w-fit">
        {([
          { chave: "atual", rotulo: "Ciclo atual" },
          { chave: "historico", rotulo: "Histórico" },
        ] as const).map((t) => (
          <button
            key={t.chave}
            onClick={() => setAba(t.chave)}
            className={cn(
              "rounded-md px-4 py-1.5 text-xs font-medium transition-colors",
              aba === t.chave
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.rotulo}
          </button>
        ))}
      </div>

      {aba === "historico" ? (
        <HistoricoCiclos
          ownerId={ownerId}
          taxaPct={config.taxaPct}
          comissaoPct={config.comissaoPct}
        />
      ) : (
      <>
      <SeletorPeriodo />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Kpi rotulo="Faturamento" valor={moeda(totais.faturamento)} icone={DollarSign} destaque />
        <Kpi rotulo="Custo de anúncios" valor={moeda(totais.investimento)} icone={Megaphone} />
        <Kpi
          rotulo="Taxa da plataforma"
          valor={moeda(taxaTotal)}
          nota={config.taxaPct > 0 ? `${config.taxaPct}% sobre o líquido` : "não configurada"}
          icone={Percent}
        />
        <Kpi
          rotulo="Reembolsos"
          valor={moeda(totais.reembolsos)}
          icone={RotateCcw}
          tom={totais.reembolsos > 0 ? "text-destructive" : undefined}
        />
        <Kpi rotulo="Lucro bruto" valor={moeda(lucroBruto)} nota="antes da comissão" icone={TrendingUp} tom={lucroBruto < 0 ? "text-destructive" : undefined} />
        <Kpi rotulo="Comissão dos vendedores" valor={moeda(comissaoTotal)} nota="soma pelo elo de cada um" icone={Wallet} />
        <Kpi
          rotulo="Lucro líquido"
          valor={moeda(lucroLiquido)}
          nota="o que sobra depois de pagar o time"
          icone={PiggyBank}
          destaque
          tom={lucroLiquido < 0 ? "text-destructive" : "text-primary"}
        />
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="border-b border-border px-5 py-4">
          <h2 className="font-semibold">Detalhamento por vendedor</h2>
          <p className="text-xs text-muted-foreground">
            Base = faturamento − reembolsos − taxa da plataforma. A comissão é o percentual
            do elo alcançado sobre essa base; sem elo, vale o percentual padrão
            ({config.comissaoPct}%).
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-5 py-3 font-medium">Vendedor</th>
                <th className="px-5 py-3 font-medium">Elo</th>
                <th className="px-5 py-3 font-medium">Faturamento</th>
                <th className="px-5 py-3 font-medium">Reembolsos</th>
                <th className="px-5 py-3 font-medium">Taxa</th>
                <th className="px-5 py-3 font-medium">Base</th>
                <th className="px-5 py-3 font-medium">Comissão</th>
                <th className="px-5 py-3 font-medium">ROI</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.userId!} className="border-b border-border/50 last:border-0">
                  <td className="px-5 py-3 font-medium">{l.nome}</td>
                  <td className="px-5 py-3">
                    {l.elo ? (
                      <span
                        className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase text-white"
                        style={{ backgroundColor: l.elo.color }}
                      >
                        {l.elo.name}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">sem elo</span>
                    )}
                  </td>
                  <td className="px-5 py-3 tabular-nums">{moeda(l.faturamento)}</td>
                  <td className={l.reembolsos > 0 ? "px-5 py-3 tabular-nums text-destructive" : "px-5 py-3 tabular-nums text-muted-foreground"}>
                    {moeda(l.reembolsos)}
                  </td>
                  <td className="px-5 py-3 tabular-nums text-muted-foreground">{moeda(l.taxa)}</td>
                  {/* A base aparece na tabela de propósito: é sobre ela que a
                      conta é feita, e vendedor que não vê a base contesta a
                      comissão. */}
                  <td className="px-5 py-3 tabular-nums font-medium">{moeda(l.base)}</td>
                  <td className="px-5 py-3 tabular-nums font-semibold text-primary">
                    {moeda(l.comissao)}
                    {l.elo && (
                      <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                        {Number(l.elo.commission_pct)}%
                        {l.bonus > 0 && ` + ${moeda(l.bonus)} bônus`}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 tabular-nums">
                    {/* Traço em vez de 0.00x: sem anúncio não existe retorno
                        sobre anúncio, e o zero faria parecer desempenho ruim. */}
                    {l.roi === null ? "—" : `${(l.roi * 100).toFixed(0)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {linhas.length === 0 && (
          <div className="p-6">
            <Vazio>Nenhum vendedor no ciclo.</Vazio>
          </div>
        )}
      </Card>

      </>
      )}

      {aba === "atual" && tiers.length === 0 && (
        <Card className="border-amber-500/40">
          <p className="text-sm text-amber-500">
            Nenhum elo cadastrado — sem os cortes não há percentual, e toda comissão sai
            zerada. Defina os elos em Configurar, no Dashboard.
          </p>
        </Card>
      )}
    </div>
  );
}
