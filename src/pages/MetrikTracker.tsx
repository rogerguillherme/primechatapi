import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { subDays } from "date-fns";
import { MapPin, Filter } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useMetrikData } from "@/hooks/use-metrik-data";
import { useMetrikPeriodo } from "@/hooks/use-metrik-periodo";
import { SeletorPeriodo } from "@/components/metrics/SeletorPeriodo";
import { useFavicon } from "@/hooks/use-favicon";
import { Card, Barra, TituloPagina, Vazio, moeda } from "@/components/metrics/ui";
import { estadoPorTelefone } from "@/lib/ddd";
import { cn } from "@/lib/utils";

/**
 * Tracker: de onde vem e por onde passa cada contato.
 *
 * Duas perguntas, dois blocos. Geolocalização responde "onde estão" a partir do
 * DDD do telefone — o único dado de local que a operação coleta de verdade. O
 * funil responde "quantos sobrevivem a cada etapa", medido sobre `leads` e
 * `orders`; nenhuma etapa é estimada, e etapa sem dado aparece vazia em vez de
 * zerada.
 */
type Modo = "vendas" | "leads";
type Janela = 7 | 14 | 30;

export default function MetrikTracker() {
  useFavicon("/metrik-favicon.svg");

  const { inicio, fim } = useMetrikPeriodo();
  const { ownerId } = useMetrikData(inicio, fim);

  const [modo, setModo] = useState<Modo>("vendas");
  const [tabela, setTabela] = useState(false);
  const [janela, setJanela] = useState<Janela>(7);

  /** Compradores do período: telefone do lead de cada venda aprovada. */
  const { data: compras = [] } = useQuery({
    queryKey: ["tracker-compras", ownerId, inicio.toISOString(), fim.toISOString()],
    enabled: !!ownerId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("orders")
        .select("amount, leads!inner(phone)")
        .eq("status", "approved")
        .gte("created_at", inicio.toISOString())
        .lte("created_at", fim.toISOString())
        .limit(5000);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: leadsPeriodo = [] } = useQuery({
    queryKey: ["tracker-leads", ownerId, inicio.toISOString(), fim.toISOString()],
    enabled: !!ownerId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("leads")
        .select("phone")
        .gte("created_at", inicio.toISOString())
        .lte("created_at", fim.toISOString())
        .limit(5000);
      if (error) throw error;
      return data || [];
    },
  });

  const estados = useMemo(() => {
    const m = new Map<string, { estado: string; uf: string; qtd: number; valor: number }>();
    const fonte =
      modo === "vendas"
        ? (compras as any[]).map((o) => ({
            phone: o.leads?.phone,
            valor: Number(o.amount) || 0,
          }))
        : (leadsPeriodo as any[]).map((l) => ({ phone: l.phone, valor: 0 }));

    for (const item of fonte) {
      const e = estadoPorTelefone(item.phone);
      if (!e) continue;
      const linha = m.get(e.uf) || { estado: e.estado, uf: e.uf, qtd: 0, valor: 0 };
      linha.qtd += 1;
      linha.valor += item.valor;
      m.set(e.uf, linha);
    }
    return [...m.values()].sort((a, b) => b.qtd - a.qtd);
  }, [compras, leadsPeriodo, modo]);

  const maior = Math.max(1, ...estados.map((e) => e.qtd));
  const totalMapeado = estados.reduce((s, e) => s + e.qtd, 0);

  /** Funil das últimas N dias: criado → respondeu → comprou. */
  const desde = useMemo(() => subDays(new Date(), janela).toISOString(), [janela]);

  const { data: funil } = useQuery({
    queryKey: ["tracker-funil", ownerId, janela],
    enabled: !!ownerId,
    queryFn: async () => {
      const criados = await (supabase as any)
        .from("leads")
        .select("id", { count: "exact", head: true })
        .gte("created_at", desde);
      if (criados.error) throw criados.error;

      const responderam = await (supabase as any)
        .from("leads")
        .select("id", { count: "exact", head: true })
        .gte("created_at", desde)
        .not("last_inbound_at", "is", null);
      if (responderam.error) throw responderam.error;

      const compraram = await (supabase as any)
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("status", "approved")
        .gte("created_at", desde);
      if (compraram.error) throw compraram.error;

      return {
        criados: criados.count || 0,
        responderam: responderam.count || 0,
        compraram: compraram.count || 0,
      };
    },
  });

  const etapas = funil
    ? [
        { rotulo: "Leads criados", valor: funil.criados },
        { rotulo: "Responderam", valor: funil.responderam },
        { rotulo: "Compraram", valor: funil.compraram },
      ]
    : [];
  const topo = Math.max(1, funil?.criados || 0);
  const conversaoGeral = funil && funil.criados > 0 ? funil.compraram / funil.criados : null;

  return (
    <div className="space-y-6">
      <TituloPagina
        titulo="Tracker"
        sub="Origem geográfica e sobrevivência do contato até a venda"
      />

      <SeletorPeriodo />

      {/* ── Geolocalização ── */}
      <Card>
        <div className="flex flex-wrap items-start gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-semibold">
              <MapPin size={16} className="text-primary" />
              Geolocalização
            </h2>
            <p className="text-xs text-muted-foreground">
              {modo === "vendas"
                ? "Vendas confirmadas por estado (DDD do comprador)"
                : "Leads por estado (DDD do contato)"}
            </p>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-border p-0.5">
              {(["vendas", "leads"] as Modo[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setModo(m)}
                  className={cn(
                    "rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors",
                    modo === m
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
            <button
              onClick={() => setTabela((v) => !v)}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <Filter size={13} />
              {tabela ? "Ver ranking" : "Ver tabela"}
            </button>
          </div>
        </div>

        {estados.length === 0 ? (
          <div className="mt-4">
            <Vazio>
              Nenhum telefone com DDD reconhecível no período — sem ele não há como situar
              o contato num estado.
            </Vazio>
          </div>
        ) : tabela ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="py-2 text-left font-medium">Estado</th>
                  <th className="py-2 text-right font-medium">
                    {modo === "vendas" ? "Vendas" : "Leads"}
                  </th>
                  <th className="py-2 text-right font-medium">Participação</th>
                  {modo === "vendas" && <th className="py-2 text-right font-medium">Valor</th>}
                </tr>
              </thead>
              <tbody>
                {estados.map((e) => (
                  <tr key={e.uf} className="border-b border-border/50 last:border-0">
                    <td className="py-2">
                      {e.estado} <span className="text-muted-foreground">({e.uf})</span>
                    </td>
                    <td className="py-2 text-right tabular-nums">{e.qtd}</td>
                    <td className="py-2 text-right tabular-nums text-muted-foreground">
                      {((e.qtd / totalMapeado) * 100).toFixed(1)}%
                    </td>
                    {modo === "vendas" && (
                      <td className="py-2 text-right tabular-nums">{moeda(e.valor)}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {estados.slice(0, 10).map((e, i) => (
              <div key={e.uf} className="space-y-1.5">
                <div className="flex items-baseline gap-2 text-sm">
                  <span className="w-5 shrink-0 text-xs tabular-nums text-muted-foreground">
                    {i + 1}.
                  </span>
                  <span className="font-medium">{e.estado}</span>
                  {modo === "vendas" && (
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {moeda(e.valor)}
                    </span>
                  )}
                  <span className="ml-auto tabular-nums">{e.qtd}</span>
                </div>
                <Barra valor={e.qtd / maior} />
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── Funil ── */}
      <Card>
        <div className="flex flex-wrap items-start gap-3">
          <div>
            <h2 className="font-semibold uppercase tracking-wide">Funil de conversão</h2>
            <p className="text-xs text-muted-foreground">
              Últimos {janela}d · leads, respostas e vendas
            </p>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <div className="flex rounded-lg border border-border p-0.5">
              {([7, 14, 30] as Janela[]).map((j) => (
                <button
                  key={j}
                  onClick={() => setJanela(j)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium tabular-nums transition-colors",
                    janela === j
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {j}D
                </button>
              ))}
            </div>
            <div className="rounded-lg border border-border px-3 py-1.5 text-right">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Conversão geral
              </p>
              <p className="text-lg font-bold tabular-nums text-primary">
                {conversaoGeral === null ? "—" : `${(conversaoGeral * 100).toFixed(2)}%`}
              </p>
            </div>
          </div>
        </div>

        {etapas.length === 0 ? (
          <div className="mt-4">
            <Vazio>Carregando as etapas…</Vazio>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            {etapas.map((e, i) => {
              const anterior = i === 0 ? null : etapas[i - 1].valor;
              return (
                <div key={e.rotulo} className="space-y-1.5">
                  <div className="flex flex-wrap items-baseline gap-2 text-sm">
                    <span className="font-medium">{e.rotulo}</span>
                    {anterior !== null && (
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {anterior > 0
                          ? `${((e.valor / anterior) * 100).toFixed(1)}% da etapa anterior`
                          : "etapa anterior vazia"}
                      </span>
                    )}
                    <span className="ml-auto text-lg font-bold tabular-nums">{e.valor}</span>
                  </div>
                  <Barra valor={e.valor / topo} alta />
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
