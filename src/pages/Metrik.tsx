import { useMemo, useState } from "react";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import { DollarSign, TrendingUp, CheckCircle2, Users } from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

import { useMetrikData } from "@/hooks/use-metrik-data";
import { MetrikSettings } from "@/components/metrics/MetrikSettings";
import { useFavicon } from "@/hooks/use-favicon";
import { cn } from "@/lib/utils";
import { roas, roi } from "../../supabase/functions/_shared/metrics-engine.mjs";

const moeda = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const compacto = (v: number) =>
  v.toLocaleString("pt-BR", { notation: "compact", maximumFractionDigits: 1 });

function Kpi({
  rotulo,
  valor,
  nota,
  icone: Icone,
  tom,
}: {
  rotulo: string;
  valor: string;
  nota?: string;
  icone: typeof DollarSign;
  tom?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-muted-foreground">{rotulo}</p>
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <Icone size={16} />
        </div>
      </div>
      <p className={cn("mt-3 text-3xl font-bold tabular-nums tracking-tight", tom)}>{valor}</p>
      {nota && <p className="mt-1 text-xs text-muted-foreground">{nota}</p>}
    </div>
  );
}

export default function Metrik() {
  useFavicon("/metrik-favicon.svg");

  const [mes] = useState(() => new Date());
  const inicio = useMemo(() => startOfMonth(mes), [mes]);
  const fim = useMemo(() => endOfMonth(mes), [mes]);

  const { ownerId, podeConfigurar, membros, tiers, meta, totais, porDia, carregando, erro } =
    useMetrikData(inicio, fim);

  const r = roi(totais.faturamento, totais.investimento) as number | null;
  const ro = roas(totais.faturamento, totais.investimento) as number | null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-3xl font-display font-bold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {format(inicio, "dd 'de' MMMM", { locale: ptBR })} a{" "}
            {format(fim, "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
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
            />
          </div>
        )}
      </div>

      {erro && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Não foi possível carregar as vendas: {erro.message}
        </p>
      )}

      {/* ── KPIs ── */}
      <div className="metrik-glow grid gap-4 sm:grid-cols-2 xl:grid-cols-4 rounded-xl">
        <Kpi
          rotulo="Faturamento"
          valor={moeda(totais.faturamento)}
          nota={`${totais.vendas} venda(s) aprovada(s)`}
          icone={DollarSign}
        />
        <Kpi
          rotulo="Lucro"
          valor={moeda(totais.lucro)}
          nota="faturamento − reembolsos − anúncio"
          icone={TrendingUp}
          tom={totais.lucro < 0 ? "text-destructive" : undefined}
        />
        <Kpi
          rotulo="Reembolsos"
          valor={moeda(totais.reembolsos)}
          nota="devoluções e chargebacks"
          icone={CheckCircle2}
          tom={totais.reembolsos > 0 ? "text-destructive" : undefined}
        />
        <Kpi
          rotulo="Vendedores ativos"
          valor={String(totais.ativos)}
          nota="com ao menos uma venda"
          icone={Users}
        />
      </div>

      {/* ── Anúncio ──
          Separado dos KPIs de venda porque depende de um número lançado à mão.
          Misturar os dois faria o zero de investimento parecer resultado, e não
          ausência de dado. */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi rotulo="Investido em anúncio" valor={moeda(totais.investimento)} icone={DollarSign} />
        <Kpi
          rotulo="ROAS"
          valor={ro === null ? "—" : `${ro.toFixed(2)}x`}
          nota={ro === null ? "sem investimento lançado" : "retorno por real gasto"}
          icone={TrendingUp}
        />
        <Kpi
          rotulo="ROI"
          valor={r === null ? "—" : `${(r * 100).toFixed(0)}%`}
          nota={r === null ? "sem investimento lançado" : "lucro sobre o investido"}
          icone={TrendingUp}
          tom={r !== null && r < 0 ? "text-destructive" : undefined}
        />
      </div>

      {/* ── Evolução ── */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-semibold">Evolução no período</h2>
        <p className="text-xs text-muted-foreground">Faturamento e reembolsos por dia</p>

        <div className="mt-4 h-[280px]">
          {carregando ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Carregando…
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={porDia} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
                <defs>
                  <linearGradient id="gFat" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis
                  dataKey="dia"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={24}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => compacto(Number(v))}
                />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(v: any, nome: string) => [moeda(Number(v)), nome]}
                />
                <Area
                  type="monotone"
                  dataKey="faturamento"
                  name="Faturamento"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  fill="url(#gFat)"
                />
                <Area
                  type="monotone"
                  dataKey="reembolsos"
                  name="Reembolsos"
                  stroke="hsl(var(--destructive))"
                  strokeWidth={1.5}
                  fill="none"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── Elos ── */}
      {tiers.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-semibold">Elos e comissão</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {tiers.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5"
              >
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: t.color }}
                />
                <span className="text-sm font-medium">{t.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {moeda(Number(t.min_value))} · {Number(t.commission_pct)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
