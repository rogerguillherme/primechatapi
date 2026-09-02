import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfMonth, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";

import { supabase } from "@/integrations/supabase/client";
import { Card, Vazio, moeda, compacto } from "@/components/metrics/ui";
import { baseComissao } from "../../../supabase/functions/_shared/metrics-engine.mjs";

/**
 * Histórico de ciclos fechados.
 *
 * Os números são RECALCULADOS a partir de `orders`, não congelados numa tabela
 * de fechamento. Congelar tem uma vantagem — o que foi pago fica registrado —
 * e um defeito grave: um reembolso que entra depois some do histórico, e o mês
 * passado passa a mentir. Aqui o passado se corrige sozinho quando o dado muda,
 * e a diferença entre o que foi pago e o que deveria ter sido fica visível em
 * vez de escondida.
 *
 * Doze meses porque é o recorte que responde "como estamos contra o ano
 * passado" sem trazer o banco inteiro para a tela.
 */
const MESES = 12;

interface Props {
  ownerId: string | null;
  taxaPct: number;
  comissaoPct: number;
}

export function HistoricoCiclos({ ownerId, taxaPct, comissaoPct }: Props) {
  const desde = useMemo(() => startOfMonth(subMonths(new Date(), MESES - 1)), []);

  const { data: vendas = [], isLoading } = useQuery({
    queryKey: ["metrik-historico-ciclos", ownerId, desde.toISOString()],
    enabled: !!ownerId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("orders")
        .select("amount, status, created_at")
        .in("status", ["approved", "refunded", "chargeback"])
        .gte("created_at", desde.toISOString())
        .limit(20000);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: gastos = [] } = useQuery({
    queryKey: ["metrik-historico-gastos", ownerId],
    enabled: !!ownerId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("metrics_ad_spend")
        .select("amount, period_start")
        .eq("owner_id", ownerId)
        .gte("period_start", format(desde, "yyyy-MM-dd"));
      if (error) throw error;
      return data || [];
    },
  });

  const ciclos = useMemo(() => {
    const m = new Map<
      string,
      { chave: string; mes: string; faturamento: number; reembolsos: number; investimento: number; vendas: number }
    >();

    // Todos os meses da janela existem, mesmo os sem venda: mês faltando na
    // tabela lê como se não tivesse acontecido, e não como resultado zero.
    for (let i = MESES - 1; i >= 0; i--) {
      const d = startOfMonth(subMonths(new Date(), i));
      const chave = format(d, "yyyy-MM");
      m.set(chave, {
        chave,
        mes: format(d, "MMM/yy", { locale: ptBR }),
        faturamento: 0,
        reembolsos: 0,
        investimento: 0,
        vendas: 0,
      });
    }

    for (const o of vendas as any[]) {
      const chave = format(new Date(o.created_at), "yyyy-MM");
      const linha = m.get(chave);
      if (!linha) continue;
      const valor = Number(o.amount) || 0;
      if (o.status === "approved") {
        linha.faturamento += valor;
        linha.vendas += 1;
      } else {
        linha.reembolsos += valor;
      }
    }

    for (const g of gastos as any[]) {
      const chave = String(g.period_start).slice(0, 7);
      const linha = m.get(chave);
      if (linha) linha.investimento += Number(g.amount) || 0;
    }

    return [...m.values()].map((c) => {
      const base = baseComissao(c.faturamento, c.reembolsos, taxaPct) as number;
      const taxa = Math.round((c.faturamento - c.reembolsos) * (taxaPct / 100) * 100) / 100;
      const comissao = Math.round(base * comissaoPct) / 100;
      return {
        ...c,
        taxa: taxa > 0 ? taxa : 0,
        base,
        comissao,
        liquido: c.faturamento - c.reembolsos - (taxa > 0 ? taxa : 0) - c.investimento - comissao,
      };
    });
  }, [vendas, gastos, taxaPct, comissaoPct]);

  const comMovimento = ciclos.filter((c) => c.faturamento > 0 || c.reembolsos > 0);

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="font-semibold">Faturamento e comissão por mês</h2>
        <p className="text-xs text-muted-foreground">
          Últimos {MESES} meses, recalculados a partir das vendas
        </p>

        <div className="mt-4 h-[260px]">
          {isLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Carregando…
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ciclos} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={(v) => compacto(Number(v))} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(v: any, nome: string) => [moeda(Number(v)), nome]}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="faturamento" name="Faturamento" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                <Bar dataKey="comissao" name="Comissão" fill="hsl(152 40% 60%)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-5 py-3 font-medium">Ciclo</th>
                <th className="px-5 py-3 font-medium">Vendas</th>
                <th className="px-5 py-3 font-medium">Faturamento</th>
                <th className="px-5 py-3 font-medium">Reembolsos</th>
                <th className="px-5 py-3 font-medium">Taxa</th>
                <th className="px-5 py-3 font-medium">Anúncio</th>
                <th className="px-5 py-3 font-medium">Comissão</th>
                <th className="px-5 py-3 font-medium">Líquido</th>
              </tr>
            </thead>
            <tbody>
              {[...comMovimento].reverse().map((c) => (
                <tr key={c.chave} className="border-b border-border/50 last:border-0">
                  <td className="px-5 py-3 font-medium capitalize">{c.mes}</td>
                  <td className="px-5 py-3 tabular-nums">{c.vendas}</td>
                  <td className="px-5 py-3 tabular-nums">{moeda(c.faturamento)}</td>
                  <td className={c.reembolsos > 0 ? "px-5 py-3 tabular-nums text-destructive" : "px-5 py-3 tabular-nums text-muted-foreground"}>
                    {moeda(c.reembolsos)}
                  </td>
                  <td className="px-5 py-3 tabular-nums text-muted-foreground">{moeda(c.taxa)}</td>
                  <td className="px-5 py-3 tabular-nums text-muted-foreground">{moeda(c.investimento)}</td>
                  <td className="px-5 py-3 tabular-nums text-primary font-semibold">{moeda(c.comissao)}</td>
                  <td className={c.liquido < 0 ? "px-5 py-3 tabular-nums font-semibold text-destructive" : "px-5 py-3 tabular-nums font-semibold"}>
                    {moeda(c.liquido)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!isLoading && comMovimento.length === 0 && (
          <div className="p-6">
            <Vazio>Nenhum ciclo com movimento nos últimos {MESES} meses.</Vazio>
          </div>
        )}
      </Card>

      <p className="text-xs text-muted-foreground">
        A comissão do histórico usa o percentual padrão ({comissaoPct}%) sobre a base do mês,
        não o elo de cada vendedor — o elo é do período corrente e recalculá-lo mês a mês
        para trás daria um número que nunca foi o combinado na época.
      </p>
    </div>
  );
}
