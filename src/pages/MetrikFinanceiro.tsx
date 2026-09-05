import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Wallet, Receipt, RotateCcw, TrendingUp } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useMetrikData } from "@/hooks/use-metrik-data";
import { useMetrikPeriodo } from "@/hooks/use-metrik-periodo";
import { SeletorPeriodo } from "@/components/metrics/SeletorPeriodo";
import { useFavicon } from "@/hooks/use-favicon";
import { Card, Kpi, Barra, TituloPagina, Vazio, moeda } from "@/components/metrics/ui";

/**
 * Financeiro: o caminho do dinheiro do bruto até o lucro.
 *
 * A cascata é explícita de propósito — bruto, reembolso, taxa, anúncio, lucro —
 * porque painel que mostra só faturamento faz a operação comemorar receita que
 * nunca chegou na conta.
 */
export default function MetrikFinanceiro() {
  useFavicon("/metrik-favicon.svg");

  const { inicio, fim } = useMetrikPeriodo();
  const { ownerId, totais, config } = useMetrikData(inicio, fim);

  const { data: pedidos = [] } = useQuery({
    queryKey: ["financeiro-pedidos", ownerId, inicio.toISOString(), fim.toISOString()],
    enabled: !!ownerId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("orders")
        .select("amount, net_amount, status, platform, payment_method")
        .gte("created_at", inicio.toISOString())
        .lte("created_at", fim.toISOString())
        .limit(5000);
      if (error) throw error;
      return data || [];
    },
  });

  const porPlataforma = useMemo(() => {
    const m = new Map<
      string,
      { nome: string; vendas: number; bruto: number; liquido: number; reembolsos: number }
    >();
    for (const o of pedidos as any[]) {
      const nome = o.platform || "Sem plataforma";
      const linha = m.get(nome) || { nome, vendas: 0, bruto: 0, liquido: 0, reembolsos: 0 };
      const valor = Number(o.amount) || 0;
      if (o.status === "refunded" || o.status === "chargeback") {
        linha.reembolsos += valor;
      } else if (o.status === "approved") {
        linha.vendas += 1;
        linha.bruto += valor;
        linha.liquido += Number(o.net_amount ?? o.amount) || 0;
      }
      m.set(nome, linha);
    }
    return [...m.values()].sort((a, b) => b.bruto - a.bruto);
  }, [pedidos]);

  const porPagamento = useMemo(() => {
    const m = new Map<string, { nome: string; vendas: number; bruto: number }>();
    for (const o of pedidos as any[]) {
      if (o.status !== "approved") continue;
      const nome = o.payment_method || "Não informado";
      const linha = m.get(nome) || { nome, vendas: 0, bruto: 0 };
      linha.vendas += 1;
      linha.bruto += Number(o.amount) || 0;
      m.set(nome, linha);
    }
    return [...m.values()].sort((a, b) => b.bruto - a.bruto);
  }, [pedidos]);

  const maiorPag = Math.max(1, ...porPagamento.map((p) => p.bruto));

  /** Cascata: cada linha desconta da anterior, na ordem em que o dinheiro sai. */
  const cascata = [
    { rotulo: "Faturamento bruto", valor: totais.faturamento, sinal: 0 },
    { rotulo: "Reembolsos e estornos", valor: -totais.reembolsos, sinal: -1 },
    { rotulo: "Taxas de plataforma", valor: -totais.taxa, sinal: -1 },
    { rotulo: "Receita líquida", valor: totais.liquido, sinal: 0 },
    { rotulo: "Investimento em anúncio", valor: -totais.investimento, sinal: -1 },
    { rotulo: "Lucro", valor: totais.lucro, sinal: 0 },
  ];
  const escala = Math.max(1, totais.faturamento);

  const baseComissao =
    (config.descontarTaxas || config.descontarReembolsos || config.descontarAds
      ? totais.liquido - (config.descontarAds ? totais.investimento : 0)
      : totais.faturamento) || 0;
  const comissao = Math.max(0, baseComissao) * ((config.comissaoPct || 0) / 100);

  return (
    <div className="space-y-6">
      <TituloPagina titulo="Financeiro" sub="Do bruto ao lucro, com cada desconto no caminho" />

      <SeletorPeriodo />

      <div className="metrik-glow grid gap-4 rounded-xl sm:grid-cols-2 xl:grid-cols-4">
        <Kpi rotulo="Bruto" valor={moeda(totais.faturamento)} nota={`${totais.vendas} venda(s)`} icone={Wallet} destaque />
        <Kpi rotulo="Taxas" valor={moeda(totais.taxa)} nota="retidas pela plataforma" icone={Receipt} />
        <Kpi
          rotulo="Reembolsos"
          valor={moeda(totais.reembolsos)}
          nota="devolvido ao cliente"
          icone={RotateCcw}
          tom={totais.reembolsos > 0 ? "text-destructive" : undefined}
        />
        <Kpi
          rotulo="Lucro"
          valor={moeda(totais.lucro)}
          nota="depois de tudo"
          icone={TrendingUp}
          tom={totais.lucro < 0 ? "text-destructive" : undefined}
        />
      </div>

      <Card>
        <h2 className="font-semibold">Onde o dinheiro foi</h2>
        <p className="text-xs text-muted-foreground">Cascata do período</p>

        <div className="mt-4 space-y-3">
          {cascata.map((l) => (
            <div key={l.rotulo} className="space-y-1.5">
              <div className="flex items-baseline gap-2 text-sm">
                <span className={l.sinal === 0 ? "font-medium" : "text-muted-foreground"}>
                  {l.rotulo}
                </span>
                <span
                  className={`ml-auto tabular-nums ${
                    l.sinal === -1 && l.valor !== 0
                      ? "text-destructive"
                      : l.valor < 0
                        ? "text-destructive"
                        : ""
                  }`}
                >
                  {moeda(l.valor)}
                </span>
              </div>
              <Barra
                valor={Math.abs(l.valor) / escala}
                cor={l.sinal === -1 ? "hsl(var(--destructive))" : undefined}
              />
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="font-semibold">Comissão do período</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {config.comissaoPct}% sobre{" "}
          {config.descontarTaxas || config.descontarReembolsos || config.descontarAds
            ? "a receita líquida"
            : "o faturamento bruto"}
          {config.descontarAds ? ", já sem o investimento em anúncio" : ""}
        </p>
        <p className="mt-3 text-3xl font-bold tabular-nums tracking-tight text-primary">
          {moeda(comissao)}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Base de cálculo {moeda(Math.max(0, baseComissao))} · o rateio por vendedor fica em
          Comissionados
        </p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-semibold">Por plataforma</h2>
          {porPlataforma.length === 0 ? (
            <div className="mt-3">
              <Vazio>Nenhuma venda registrada no período.</Vazio>
            </div>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="py-2 text-left font-medium">Plataforma</th>
                    <th className="py-2 text-right font-medium">Vendas</th>
                    <th className="py-2 text-right font-medium">Bruto</th>
                    <th className="py-2 text-right font-medium">Líquido</th>
                  </tr>
                </thead>
                <tbody>
                  {porPlataforma.map((p) => (
                    <tr key={p.nome} className="border-b border-border/50 last:border-0">
                      <td className="py-2 capitalize">{p.nome}</td>
                      <td className="py-2 text-right tabular-nums">{p.vendas}</td>
                      <td className="py-2 text-right tabular-nums">{moeda(p.bruto)}</td>
                      <td className="py-2 text-right tabular-nums text-muted-foreground">
                        {moeda(p.liquido)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <h2 className="font-semibold">Por forma de pagamento</h2>
          {porPagamento.length === 0 ? (
            <div className="mt-3">
              <Vazio>Nenhuma venda aprovada no período.</Vazio>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {porPagamento.map((p) => (
                <div key={p.nome} className="space-y-1.5">
                  <div className="flex items-baseline gap-2 text-sm">
                    <span className="font-medium capitalize">{p.nome}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {p.vendas} venda(s)
                    </span>
                    <span className="ml-auto tabular-nums">{moeda(p.bruto)}</span>
                  </div>
                  <Barra valor={p.bruto / maiorPag} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
