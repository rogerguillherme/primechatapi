import type { ComponentType, ReactNode } from "react";
import type { LucideProps } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Peças visuais compartilhadas do Metrik.
 *
 * O relevo mora aqui e não em cada tela: sete páginas com sombras escritas à
 * mão divergem na terceira, e cartão com profundidade diferente do vizinho é o
 * tipo de coisa que ninguém sabe nomear mas todo mundo percebe como desleixo.
 */

export const moeda = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const compacto = (v: number) =>
  v.toLocaleString("pt-BR", { notation: "compact", maximumFractionDigits: 1 });

export function Card({
  children,
  className,
  destaque,
  hover,
}: {
  children: ReactNode;
  className?: string;
  destaque?: boolean;
  hover?: boolean;
}) {
  return (
    <div
      className={cn(
        "metrik-card rounded-xl p-5",
        destaque && "metrik-card-primary",
        hover && "metrik-card-hover",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Kpi({
  rotulo,
  valor,
  nota,
  icone: Icone,
  tom,
  destaque,
}: {
  rotulo: string;
  valor: string;
  nota?: string;
  /** Ícone do lucide-react; o tipo vem da própria biblioteca para não
   *  divergir da assinatura real de `size`. */
  icone?: ComponentType<LucideProps>;
  tom?: string;
  destaque?: boolean;
}) {
  return (
    <Card destaque={destaque} hover>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-muted-foreground">{rotulo}</p>
        {Icone && (
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <Icone size={16} />
          </div>
        )}
      </div>
      <p className={cn("mt-3 text-3xl font-bold tabular-nums tracking-tight", tom)}>{valor}</p>
      {nota && <p className="mt-1 text-xs text-muted-foreground">{nota}</p>}
    </Card>
  );
}

/** Barra com sulco e brilho: barra chapada no escuro parece desativada. */
export function Barra({
  valor,
  cor,
  alta,
}: {
  valor: number;
  cor?: string;
  alta?: boolean;
}) {
  return (
    <div
      className={cn("metrik-trilho rounded-full overflow-hidden", alta ? "h-2.5" : "h-1.5")}
    >
      <div
        className="metrik-preenchimento h-full rounded-full transition-all"
        style={{
          width: `${Math.min(100, Math.max(0, valor * 100))}%`,
          backgroundColor: cor || "hsl(var(--primary))",
        }}
      />
    </div>
  );
}

export function TituloPagina({ titulo, sub, acao }: { titulo: string; sub?: string; acao?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <h1 className="text-3xl font-display font-bold tracking-tight">{titulo}</h1>
        {sub && <p className="mt-1 text-sm text-muted-foreground">{sub}</p>}
      </div>
      {acao && <div className="ml-auto">{acao}</div>}
    </div>
  );
}

export function Vazio({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}
