import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useMetrikData } from "@/hooks/use-metrik-data";
import { useTeamContext } from "@/hooks/use-team";
import { useMetrikPeriodo } from "@/hooks/use-metrik-periodo";
import { SeletorPeriodo } from "@/components/metrics/SeletorPeriodo";
import { useFavicon } from "@/hooks/use-favicon";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, Barra, TituloPagina, Vazio, moeda } from "@/components/metrics/ui";
import { progressoMeta, eloAtual, proximoElo, comissao } from "../../supabase/functions/_shared/metrics-engine.mjs";

const dia = (d: Date) => format(d, "yyyy-MM-dd");

/**
 * Metas: coletiva do período e individual por vendedor.
 *
 * As individuais ficam aqui e não escondidas num diálogo porque são o que o
 * vendedor abre para saber o que se espera dele. Meta que exige três cliques
 * para ser vista é meta que ninguém consulta.
 */
export default function MetrikMetas() {
  useFavicon("/metrik-favicon.svg");
  const qc = useQueryClient();

  const { inicio, fim } = useMetrikPeriodo();

  const { ownerId, vendedores, totais, tiers, meta } = useMetrikData(inicio, fim);
  const { data: team } = useTeamContext();
  const souOwner = !team || team.accessLevel === "owner";
  const [coletiva, setColetiva] = useState("");

  const { data: individuais = [] } = useQuery({
    queryKey: ["metrics-goals-ind", ownerId, dia(inicio)],
    enabled: !!ownerId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("metrics_goals")
        .select("member_user_id, target_value")
        .eq("owner_id", ownerId)
        .eq("scope", "individual")
        .lte("period_start", dia(fim))
        .gte("period_end", dia(inicio));
      if (error) throw error;
      return data || [];
    },
  });

  const metaPor = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of individuais as any[]) m.set(g.member_user_id, Number(g.target_value) || 0);
    return m;
  }, [individuais]);

  const salvar = useMutation({
    mutationFn: async ({ escopo, membro, valor }: { escopo: "coletiva" | "individual"; membro?: string; valor: number }) => {
      // Substitui em vez de somar outra: duas metas para o mesmo período fariam
      // a barra mudar conforme a ordem em que o banco devolvesse as linhas.
      let q = (supabase as any)
        .from("metrics_goals")
        .delete()
        .eq("owner_id", ownerId)
        .eq("scope", escopo)
        .eq("period_start", dia(inicio));
      if (escopo === "individual") q = q.eq("member_user_id", membro);
      await q;

      const { error } = await (supabase as any).from("metrics_goals").insert({
        owner_id: ownerId,
        scope: escopo,
        member_user_id: escopo === "individual" ? membro : null,
        period_start: dia(inicio),
        period_end: dia(fim),
        target_value: valor,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Meta salva.");
      qc.invalidateQueries({ queryKey: ["metrics-goal"] });
      qc.invalidateQueries({ queryKey: ["metrics-goals-ind"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const progColetiva = progressoMeta(totais.faturamento, meta ?? 0) as number | null;

  return (
    <div className="space-y-6">
      <TituloPagina
        titulo="Metas"
        sub={`${format(inicio, "dd 'de' MMMM", { locale: ptBR })} a ${format(fim, "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}`}
      />

      <SeletorPeriodo />

      {/* ── Coletiva ── */}
      <Card destaque>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Meta coletiva</h2>
            <p className="text-xs text-muted-foreground">Faturamento da empresa no período</p>
          </div>
          <span className="rounded-full bg-primary/15 px-2.5 py-1 text-xs font-semibold text-primary tabular-nums">
            {progColetiva === null ? "—" : `${Math.round(progColetiva * 100)}%`}
          </span>
        </div>

        <div className="mt-4">
          <Barra valor={progColetiva ?? 0} alta />
        </div>
        <div className="mt-2 flex items-center justify-between text-sm tabular-nums">
          <span className="font-medium">{moeda(totais.faturamento)}</span>
          <span className="text-muted-foreground">{meta ? moeda(meta) : "sem meta"}</span>
        </div>

        {souOwner && (
          <div className="mt-4 flex gap-2">
            <Input
              value={coletiva}
              onChange={(e) => setColetiva(e.target.value)}
              placeholder={meta ? String(meta) : "Ex: 150000"}
              className="h-9 max-w-[220px] tabular-nums"
            />
            <Button
              size="sm"
              disabled={salvar.isPending}
              onClick={() => {
                const v = Number(coletiva.replace(",", "."));
                if (!Number.isFinite(v) || v < 0) return toast.error("Informe um valor válido");
                salvar.mutate({ escopo: "coletiva", valor: v });
              }}
            >
              Definir meta
            </Button>
          </div>
        )}
      </Card>

      {/* ── Individuais ── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Metas individuais</h2>
          <p className="text-xs text-muted-foreground">
            Quanto se espera de cada vendedor no período, e onde ele está
          </p>
        </div>

        {vendedores.filter((v) => v.userId).length === 0 && (
          <Vazio>Nenhum vendedor no time ainda.</Vazio>
        )}

        {vendedores
          .filter((v) => v.userId)
          .map((v) => {
            const alvo = metaPor.get(v.userId!) ?? 0;
            const prog = progressoMeta(v.faturamento, alvo) as number | null;
            const elo = eloAtual(tiers, v.faturamento) as any;
            const prox = proximoElo(tiers, v.faturamento) as any;
            const com = comissao(v.faturamento, tiers) as number;

            return (
              <Card key={v.userId!} hover>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{v.nome}</p>
                    <p className="text-xs text-muted-foreground">
                      {moeda(v.faturamento)}
                      {elo ? ` · ${elo.name}` : ""}
                      {com > 0 ? ` · comissão ${moeda(com)}` : ""}
                    </p>
                  </div>
                  <span className="ml-auto text-sm font-semibold tabular-nums">
                    {prog === null ? "sem meta" : `${Math.round(prog * 100)}%`}
                  </span>
                </div>

                <div className="mt-3">
                  <Barra valor={prog ?? 0} cor={elo?.color} />
                </div>

                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{alvo > 0 ? `Meta ${moeda(alvo)}` : "Meta não definida"}</span>
                  {/* O próximo elo aparece junto da meta porque são as duas
                      coisas que o vendedor quer saber: o que a empresa espera e
                      o que falta para ele ganhar mais por venda. */}
                  {prox && (
                    <span>
                      Faltam {moeda(prox.falta)} para {prox.tier.name}
                    </span>
                  )}
                </div>

                {souOwner && (
                  <div className="mt-3 flex gap-2">
                    <Input
                      defaultValue={alvo || ""}
                      placeholder="Meta do mês"
                      className="h-8 max-w-[180px] text-sm tabular-nums"
                      onBlur={(e) => {
                        const v2 = Number(e.target.value.replace(",", "."));
                        if (!Number.isFinite(v2) || v2 < 0 || v2 === alvo) return;
                        salvar.mutate({ escopo: "individual", membro: v.userId!, valor: v2 });
                      }}
                    />
                    <span className="self-center text-[11px] text-muted-foreground">
                      salva ao sair do campo
                    </span>
                  </div>
                )}
              </Card>
            );
          })}
      </section>
    </div>
  );
}
