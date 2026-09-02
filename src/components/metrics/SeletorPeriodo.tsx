import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

import { useMetrikPeriodo, type ModoPeriodo } from "@/hooks/use-metrik-periodo";
import { cn } from "@/lib/utils";

const MODOS: { chave: ModoPeriodo; rotulo: string }[] = [
  { chave: "mensal", rotulo: "Mensal" },
  { chave: "diario", rotulo: "Diário" },
  { chave: "periodo", rotulo: "Período" },
];

/**
 * Seletor de recorte, igual em todas as telas.
 *
 * Cada tela com o seu seria pior que não ter: a pessoa ajusta o período no
 * ranking, troca para comissionados e vê outro mês sem perceber que mudou.
 * Como o estado vive na URL, o recorte atravessa a navegação.
 */
export function SeletorPeriodo() {
  const { modo, inicio, fim, definir } = useMetrikPeriodo();

  return (
    <div className="metrik-card rounded-xl p-3 flex flex-wrap items-center gap-3">
      <div className="flex rounded-lg border border-border p-0.5">
        {MODOS.map((m) => (
          <button
            key={m.chave}
            onClick={() => definir({ modo: m.chave })}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              modo === m.chave
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {m.rotulo}
          </button>
        ))}
      </div>

      {modo === "mensal" && (
        <input
          type="month"
          value={format(inicio, "yyyy-MM")}
          onChange={(e) => {
            const [a, m] = e.target.value.split("-").map(Number);
            if (a && m) definir({ de: new Date(a, m - 1, 1) });
          }}
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-ring"
        />
      )}

      {modo === "diario" && (
        <input
          type="date"
          value={format(inicio, "yyyy-MM-dd")}
          onChange={(e) => e.target.value && definir({ de: new Date(e.target.value + "T12:00") })}
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-ring"
        />
      )}

      {modo === "periodo" && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={format(inicio, "yyyy-MM-dd")}
            onChange={(e) => e.target.value && definir({ de: new Date(e.target.value + "T12:00") })}
            className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-ring"
          />
          <span className="text-xs text-muted-foreground">a</span>
          <input
            type="date"
            value={format(fim, "yyyy-MM-dd")}
            onChange={(e) => e.target.value && definir({ ate: new Date(e.target.value + "T12:00") })}
            className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      )}

      <span className="ml-auto text-xs text-muted-foreground">
        {modo === "diario"
          ? format(inicio, "dd 'de' MMMM 'de' yyyy", { locale: ptBR })
          : `${format(inicio, "dd/MM")} a ${format(fim, "dd/MM/yyyy")}`}
      </span>
    </div>
  );
}
