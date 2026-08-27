import { cn } from "@/lib/utils";
import { progressBar, type ProgressInput } from "@/lib/sendingMetrics";

/**
 * Barra de progresso de um disparo: enviadas, entregues, lidas e erros.
 *
 * No WhatsApp esses estados são ACUMULATIVOS — lida implica entregue, que
 * implica enviada. Por isso os quatro números aparecem como contagens
 * acumulativas nos quadros, mas a barra empilha só as DIFERENÇAS entre eles.
 * Empilhar 900 enviadas + 700 entregues + 300 lidas encheria a barra três
 * vezes com a mesma mensagem.
 */
export interface SendingProgressBarProps extends ProgressInput {
  /** false para fluxos: a Meta não devolve entrega/leitura por execução */
  tracksDelivery?: boolean;
  className?: string;
  /** esconde os quadros e deixa só a barra + linha resumo */
  compact?: boolean;
}

const fmt = (v: number) => v.toLocaleString("pt-BR");

export function SendingProgressBar({
  tracksDelivery = true,
  className,
  compact = false,
  ...input
}: SendingProgressBarProps) {
  const bar = progressBar(input);
  const { segments: s, total } = bar;
  const pct = (v: number) => (total > 0 ? `${Math.round((v / total) * 100)}%` : "—");

  const tiles = [
    {
      label: "Enviadas",
      value: fmt(bar.sent),
      hint: pct(bar.sent),
      color: "text-amber-500",
      dot: "bg-amber-500",
    },
    {
      label: "Entregues",
      value: tracksDelivery ? fmt(bar.delivered) : "—",
      hint: tracksDelivery ? pct(bar.delivered) : "sem dado",
      color: "text-emerald-500",
      dot: "bg-emerald-500",
    },
    {
      label: "Lidas",
      value: tracksDelivery ? fmt(bar.read) : "—",
      hint: tracksDelivery ? pct(bar.read) : "sem dado",
      color: "text-blue-500",
      dot: "bg-blue-500",
    },
    {
      label: "Erros",
      value: fmt(bar.failed),
      hint: pct(bar.failed),
      color: "text-destructive",
      dot: "bg-destructive",
    },
  ];

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">
          {fmt(bar.sent)} de {fmt(total)} processadas
          {bar.pending > 0 && ` · ${fmt(bar.pending)} na fila`}
          {bar.skipped > 0 && ` · ${fmt(bar.skipped)} puladas`}
        </span>
        <span className="text-[11px] font-mono tabular-nums text-muted-foreground shrink-0">
          {total > 0 ? `${bar.progressPct.toFixed(0)}%` : "—"}
        </span>
      </div>

      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`${bar.sent} enviadas, ${bar.delivered} entregues, ${bar.read} lidas, ${bar.failed} com erro, de ${total}`}
      >
        <div className="h-full bg-blue-500" style={{ width: `${s.read}%` }} title={`Lidas: ${fmt(bar.read)}`} />
        <div
          className="h-full bg-emerald-500"
          style={{ width: `${s.deliveredOnly}%` }}
          title={`Entregues mas ainda não lidas: ${fmt(bar.delivered - bar.read)}`}
        />
        <div
          className="h-full bg-amber-500"
          style={{ width: `${s.sentOnly}%` }}
          title={`Enviadas sem confirmação de entrega: ${fmt(bar.sent - bar.delivered)}`}
        />
        <div
          className="h-full bg-destructive"
          style={{ width: `${s.failed}%` }}
          title={`Erros: ${fmt(bar.failed)}`}
        />
        <div
          className="h-full bg-muted-foreground/40"
          style={{ width: `${s.skipped}%` }}
          title={`Puladas: ${fmt(bar.skipped)}`}
        />
      </div>

      {compact ? (
        <p className="text-[10px] text-muted-foreground">
          <span className="text-amber-500 font-medium">{fmt(bar.sent)}</span> enviadas ·{" "}
          <span className="text-emerald-500 font-medium">
            {tracksDelivery ? fmt(bar.delivered) : "—"}
          </span>{" "}
          entregues ·{" "}
          <span className="text-blue-500 font-medium">{tracksDelivery ? fmt(bar.read) : "—"}</span>{" "}
          lidas · <span className="text-destructive font-medium">{fmt(bar.failed)}</span> com erro
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-lg border border-border/60 bg-card/40 px-2.5 py-2">
              <div className="flex items-center gap-1.5">
                <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", t.dot)} />
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">
                  {t.label}
                </p>
              </div>
              <p className={cn("text-lg font-bold tabular-nums leading-tight", t.color)}>{t.value}</p>
              <p className="text-[10px] text-muted-foreground">{t.hint} do total</p>
            </div>
          ))}
        </div>
      )}

      {!compact && tracksDelivery && (
        <p className="text-[10px] text-muted-foreground">
          Entregue e lida são acumulativas: toda lida também conta como entregue. Não some as três.
        </p>
      )}
    </div>
  );
}
