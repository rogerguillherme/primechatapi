import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Lock, Check } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useMetrikData } from "@/hooks/use-metrik-data";
import { useMetrikPeriodo } from "@/hooks/use-metrik-periodo";
import { SeletorPeriodo } from "@/components/metrics/SeletorPeriodo";
import { useFavicon } from "@/hooks/use-favicon";
import { Card, Barra, TituloPagina, Vazio, moeda } from "@/components/metrics/ui";
import { avaliarMissoes, RARIDADES } from "../../supabase/functions/_shared/missoes.mjs";
import { roi } from "../../supabase/functions/_shared/metrics-engine.mjs";
import { cn } from "@/lib/utils";

/**
 * Missões por vendedor.
 *
 * Avaliadas na leitura, sobre os números que o painel já calcula — sem tabela
 * de progresso para manter em dia. Um vendedor por vez porque conquista é
 * pessoal: a grade de todos vira parede de emojis e ninguém acha a sua.
 */
export default function MetrikMissoes() {
  useFavicon("/metrik-favicon.svg");

  const { inicio, fim } = useMetrikPeriodo();
  const { vendedores, ownerId } = useMetrikData(inicio, fim);
  const [selecionado, setSelecionado] = useState<string | null>(null);

  const comId = vendedores.filter((v) => v.userId);
  const atual = comId.find((v) => v.userId === selecionado) ?? comId[0] ?? null;

  const { data: metas = [] } = useQuery({
    queryKey: ["missoes-metas", ownerId, format(inicio, "yyyy-MM-dd")],
    enabled: !!ownerId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("metrics_goals")
        .select("member_user_id, target_value")
        .eq("owner_id", ownerId)
        .eq("scope", "individual")
        .lte("period_start", format(fim, "yyyy-MM-dd"))
        .gte("period_end", format(inicio, "yyyy-MM-dd"));
      if (error) throw error;
      return data || [];
    },
  });

  const missoes = useMemo(() => {
    if (!atual) return [];
    const meta = (metas as any[]).find((m) => m.member_user_id === atual.userId);
    return avaliarMissoes({
      vendas: atual.vendas,
      faturamento: atual.faturamento,
      lucro: atual.lucro,
      reembolsos: atual.reembolsos,
      acumulado: atual.acumulado,
      roi: roi(atual.faturamento, atual.investimento),
      meta: meta ? Number(meta.target_value) : 0,
    }) as any[];
  }, [atual, metas]);

  const conquistadas = missoes.filter((m) => m.feito).length;

  return (
    <div className="space-y-6">
      <TituloPagina titulo="Missões" sub="Conquistas por vendedor, medidas sobre o período" />

      <SeletorPeriodo />

      {comId.length === 0 && <Vazio>Nenhum vendedor no time ainda.</Vazio>}

      {comId.length > 0 && (
        <Card>
          <p className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
            Vendedor
          </p>
          <div className="flex flex-wrap gap-1.5">
            {comId.map((v) => (
              <button
                key={v.userId!}
                onClick={() => setSelecionado(v.userId!)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                  atual?.userId === v.userId
                    ? "bg-primary text-primary-foreground"
                    : "border border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {v.nome}
              </button>
            ))}
          </div>
        </Card>
      )}

      {atual && (
        <>
          <Card destaque>
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <p className="font-semibold">{atual.nome}</p>
                <p className="text-xs text-muted-foreground">
                  {moeda(atual.faturamento)} · {atual.vendas} venda(s) · acumulado{" "}
                  {moeda(atual.acumulado)}
                </p>
              </div>
              <span className="ml-auto text-2xl font-bold tabular-nums text-primary">
                {conquistadas}/{missoes.length}
              </span>
            </div>
            <div className="mt-3">
              <Barra valor={missoes.length ? conquistadas / missoes.length : 0} alta />
            </div>
          </Card>

          <div className="grid gap-3 md:grid-cols-2">
            {missoes.map((m) => {
              const r = RARIDADES[m.raridade as keyof typeof RARIDADES];
              return (
                <Card key={m.id} hover className={cn(!m.feito && "opacity-75")}>
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "rounded-lg p-2 shrink-0",
                        m.feito ? "text-white" : "bg-muted text-muted-foreground",
                      )}
                      style={m.feito ? { backgroundColor: r.cor } : undefined}
                    >
                      {m.feito ? <Check size={15} /> : <Lock size={15} />}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{m.nome}</p>
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                          style={{ backgroundColor: `${r.cor}22`, color: r.cor }}
                        >
                          {r.rotulo}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{m.desc}</p>

                      <div className="mt-2.5">
                        {/* Progresso nulo é "não dá para medir", não zero: sem
                            verba de tráfego não existe ROI, e mostrar 0% seria
                            dizer que a pessoa foi mal no que nem foi tentado. */}
                        {m.progresso === null ? (
                          <p className="text-[11px] text-muted-foreground">
                            Não se aplica ao período
                          </p>
                        ) : (
                          <>
                            <Barra valor={m.progresso} cor={m.feito ? r.cor : undefined} />
                            <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
                              {Math.round(m.progresso * 100)}%
                            </p>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
