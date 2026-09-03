import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Crown, Search } from "lucide-react";

import { useMetrikData, type Vendedor } from "@/hooks/use-metrik-data";
import { useMetrikPeriodo } from "@/hooks/use-metrik-periodo";
import { SeletorPeriodo } from "@/components/metrics/SeletorPeriodo";
import { MetrikSettings } from "@/components/metrics/MetrikSettings";
import { useFavicon } from "@/hooks/use-favicon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  eloAtual,
  proximoElo,
  progressoNoElo,
  comissao,
  progressoMeta,
  roi,
} from "../../supabase/functions/_shared/metrics-engine.mjs";

const moeda = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Escala da carreira: o acumulado de todos os tempos, de 100 mil a 1 milhão. */
const CARREIRA_MIN = 100_000;
const CARREIRA_MAX = 1_000_000;

type Ordem = "rank" | "nome" | "faturamento" | "lucro";

const ORDENS: { chave: Ordem; rotulo: string }[] = [
  { chave: "rank", rotulo: "Rank" },
  { chave: "nome", rotulo: "Nome" },
  { chave: "faturamento", rotulo: "Fat." },
  { chave: "lucro", rotulo: "Lucro" },
];

function Iniciais({ nome }: { nome: string }) {
  const letras = nome
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
  return (
    <div className="w-12 h-12 rounded-full bg-primary/15 text-primary flex items-center justify-center text-sm font-bold shrink-0">
      {letras || "?"}
    </div>
  );
}

function Metrica({ rotulo, valor, tom }: { rotulo: string; valor: string; tom?: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{rotulo}</p>
      <p className={cn("text-lg font-semibold tabular-nums leading-tight", tom)}>{valor}</p>
    </div>
  );
}

export default function MetrikRanking() {
  useFavicon("/metrik-favicon.svg");

  const { inicio, fim } = useMetrikPeriodo();

  const { ownerId, podeConfigurar, membros, tiers, temporada, meta, vendedores, totais, config } =
    useMetrikData(inicio, fim);

  const [ordem, setOrdem] = useState<Ordem>("rank");
  const [busca, setBusca] = useState("");

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const filtrada = termo
      ? vendedores.filter((v) => v.nome.toLowerCase().includes(termo))
      : vendedores;
    const copia = [...filtrada];
    if (ordem === "nome") copia.sort((a, b) => a.nome.localeCompare(b.nome));
    else if (ordem === "lucro") copia.sort((a, b) => b.lucro - a.lucro);
    else copia.sort((a, b) => b.faturamento - a.faturamento);
    return copia;
  }, [vendedores, ordem, busca]);

  const progMeta = progressoMeta(totais.faturamento, meta ?? 0) as number | null;

  return (
    <div className="space-y-6">
      {/* ── Título ── */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 text-3xl font-display font-bold tracking-tight">
            <Crown size={26} className="text-primary" />
            Ranking Gamificado
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground/80">
              {temporada || `Temporada de ${format(inicio, "MMMM 'de' yyyy", { locale: ptBR })}`}
            </span>
            {" · "}
            {format(inicio, "dd/MM")} a {format(fim, "dd/MM")}
          </p>
        </div>
        {ownerId && podeConfigurar && (
          <div className="ml-auto">
            <MetrikSettings
              ownerId={ownerId}
              tiers={tiers}
              inicio={inicio}
              fim={fim}
              metaAtual={meta}
              membros={membros}
              taxaAtual={config.taxaPct}
              pctAtual={config.comissaoPct}
            />
          </div>
        )}
      </div>

      <SeletorPeriodo />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        {/* ── Meta coletiva ── */}
        <div className="metrik-glow metrik-card metrik-card-hover rounded-xl p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">Meta coletiva</h2>
              <p className="text-xs text-muted-foreground">Progresso no período</p>
            </div>
            <span
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums",
                progMeta === null
                  ? "bg-muted text-muted-foreground"
                  : "bg-primary/15 text-primary",
              )}
            >
              {progMeta === null ? "—" : `${Math.round(progMeta * 100)}%`}
            </span>
          </div>

          <div className="mt-4 h-2 metrik-trilho rounded-full overflow-hidden">
            <div
              className="metrik-preenchimento h-full rounded-full bg-primary transition-all"
              style={{ width: `${(progMeta ?? 0) * 100}%` }}
            />
          </div>

          <div className="mt-2 flex items-center justify-between text-sm tabular-nums">
            <span className="font-medium">{moeda(totais.faturamento)}</span>
            <span className="text-muted-foreground">{meta ? moeda(meta) : "sem meta"}</span>
          </div>

          {progMeta === null && (
            // Meta zero não é 100%: é meta não definida. A barra cheia sem
            // ninguém ter conquistado nada é como o sistema avaliado errava.
            <p className="mt-3 text-xs text-muted-foreground">
              Nenhuma meta definida para este período — defina em Configurar para a barra
              medir contra alguma coisa.
            </p>
          )}
        </div>

        {/* ── Filtros ── */}
        <div className="metrik-card metrik-card-hover rounded-xl p-5 space-y-4">
          <h2 className="font-semibold">Filtros</h2>

          <div className="flex flex-wrap items-end gap-4">
            <div>
              <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                Ordenar
              </p>
              <div className="flex rounded-lg border border-border p-0.5">
                {ORDENS.map((o) => (
                  <button
                    key={o.chave}
                    onClick={() => setOrdem(o.chave)}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                      ordem === o.chave
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {o.rotulo}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 min-w-[180px]">
              <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                Buscar
              </p>
              <div className="relative">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Nome do vendedor…"
                  className="h-9 pl-9 text-sm"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Vendedores ── */}
      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-lg font-semibold">Vendedores ativos</h2>
            <p className="text-xs text-muted-foreground">
              Lista completa por performance no período
            </p>
          </div>
          <span className="ml-auto rounded-full bg-primary/15 px-2.5 py-1 text-xs font-semibold text-primary tabular-nums">
            {lista.length}
          </span>
        </div>

        {lista.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhum vendedor no período. O vendedor de uma venda é o atendente responsável
            pelo lead no CRM.
          </p>
        )}

        {lista.map((v: Vendedor, i) => {
          const elo = v.userId ? (eloAtual(tiers, v.faturamento) as any) : null;
          const prox = v.userId ? (proximoElo(tiers, v.faturamento) as any) : null;
          const prog = v.userId ? (progressoNoElo(tiers, v.faturamento) as number) : 0;
          const com = v.userId ? (comissao(v.faturamento, tiers) as number) : 0;
          const r = v.userId ? (roi(v.faturamento, v.investimento) as number | null) : null;

          const carreira = Math.min(
            1,
            Math.max(0, (v.acumulado - CARREIRA_MIN) / (CARREIRA_MAX - CARREIRA_MIN)),
          );

          return (
            <div
              key={v.userId || "sem"}
              className={cn(
                "metrik-card metrik-card-hover rounded-xl p-5",
                !v.userId && "border-dashed",
              )}
            >
              <div className="grid gap-5 lg:grid-cols-[minmax(200px,1fr)_minmax(0,1.4fr)_minmax(220px,1fr)]">
                {/* Identidade */}
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold tabular-nums text-muted-foreground w-6">
                    {v.userId ? `#${i + 1}` : "—"}
                  </span>
                  <Iniciais nome={v.nome} />
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{v.nome}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {elo && (
                        <span
                          className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
                          style={{ backgroundColor: elo.color }}
                        >
                          {elo.name}
                        </span>
                      )}
                      {/* Traço, não "0.00x": sem investimento não existe
                          retorno sobre investimento, e um zero faria parecer
                          desempenho ruim de quem simplesmente não teve verba. */}
                      <span className="rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        ROI {r === null ? "—" : `${(r * 100).toFixed(0)}%`}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Números */}
                <div className="grid grid-cols-3 gap-x-4 gap-y-3">
                  <Metrica rotulo="Faturamento" valor={moeda(v.faturamento)} />
                  <Metrica
                    rotulo="Líquido"
                    valor={moeda(v.liquido)}
                    tom={v.liquido < 0 ? "text-destructive" : undefined}
                  />
                  <Metrica rotulo="Investimento" valor={moeda(v.investimento)} />
                  <Metrica
                    rotulo="Reembolsos"
                    valor={moeda(v.reembolsos)}
                    tom={v.reembolsos > 0 ? "text-destructive" : undefined}
                  />
                  <Metrica rotulo="Vendas" valor={String(v.vendas)} />
                  <Metrica rotulo="Comissão" valor={moeda(com)} tom="text-primary" />
                </div>

                {/* Progresso de elo */}
                <div>
                  <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
                    <span>Progresso de elo</span>
                    <span className="tabular-nums">{Math.round(prog * 100)}%</span>
                  </div>
                  <div className="mt-1.5 h-1.5 metrik-trilho rounded-full overflow-hidden">
                    <div
                      className="metrik-preenchimento h-full rounded-full transition-all"
                      style={{
                        width: `${prog * 100}%`,
                        backgroundColor: elo?.color || "hsl(var(--primary))",
                      }}
                    />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{elo?.name || "sem elo"}</span>
                    {prox && (
                      <span className="text-muted-foreground">
                        {prox.tier.name} • {moeda(Number(prox.tier.min_value))}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Progressão de carreira — a recompensa longa, que não zera todo mês */}
              {v.userId && (
                <div className="mt-5 border-t border-border/60 pt-4">
                  <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
                    <span>Progressão de carreira</span>
                    <span className="tabular-nums text-foreground/80">
                      {moeda(v.acumulado)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 metrik-trilho rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-primary/50 to-primary transition-all"
                      style={{ width: `${carreira * 100}%` }}
                    />
                  </div>
                  <div className="mt-1 flex justify-between text-[10px] text-muted-foreground tabular-nums">
                    <span>100k</span>
                    <span>1M</span>
                  </div>
                </div>
              )}

              {!v.userId && (
                <p className="mt-3 text-xs text-amber-500">
                  Vendas sem atendente responsável — não entram em comissão até serem
                  atribuídas no CRM.
                </p>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}
