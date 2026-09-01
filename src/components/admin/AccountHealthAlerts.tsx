import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ShieldAlert, ShieldCheck, Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Aviso ao admin quando uma conta de cliente começa a degradar.
 *
 * Os sinais já existiam, mas nenhum chegava a quem podia agir: a nota de
 * qualidade só aparecia se o próprio cliente abrisse a tela de limites, e a
 * taxa de falha ninguém somava. Um cliente descobria pelo silêncio — que é
 * como o Estevao descobriu.
 */

type Nivel = "critico" | "alto" | "medio";

interface Aviso {
  account_id: string;
  conta: string;
  dono: string | null;
  nivel: Nivel;
  titulo: string;
  detalhe: string;
  quality_rating?: string | null;
  enviadas_24h?: number;
  falhas_24h?: number;
}

const ESTILO: Record<Nivel, { caixa: string; texto: string; rotulo: string }> = {
  critico: {
    caixa: "border-destructive/40 bg-destructive/5",
    texto: "text-destructive",
    rotulo: "Crítico",
  },
  alto: {
    caixa: "border-amber-500/40 bg-amber-500/5",
    texto: "text-amber-700 dark:text-amber-500",
    rotulo: "Atenção",
  },
  medio: {
    caixa: "border-border bg-muted/30",
    texto: "text-muted-foreground",
    rotulo: "Observar",
  },
};

export function AccountHealthAlerts() {
  const { data, isFetching, refetch, error } = useQuery({
    queryKey: ["admin-account-health"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("admin-account-health");
      if (error) throw error;
      return data as { avisos: Aviso[]; contas_verificadas: number };
    },
    // A consulta bate na Graph uma vez por conta; refazer a cada foco de janela
    // seria caro e não muda de minuto a minuto.
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const avisos = data?.avisos ?? [];

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldAlert size={18} className="text-muted-foreground" />
          <h2 className="text-base font-semibold">Saúde das contas</h2>
          {data && (
            <span className="text-xs text-muted-foreground">
              {data.contas_verificadas} verificadas
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="gap-1.5 text-xs"
        >
          <RefreshCw size={13} className={cn(isFetching && "animate-spin")} />
          Verificar
        </Button>
      </div>

      {isFetching && !data && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin" /> Consultando a Meta conta a conta…
        </p>
      )}

      {error && (
        <p className="text-sm text-destructive">
          Não foi possível verificar: {(error as { message?: string })?.message || String(error)}
        </p>
      )}

      {data && avisos.length === 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
          <ShieldCheck size={15} className="text-emerald-600 dark:text-emerald-500 shrink-0" />
          <p className="text-sm text-muted-foreground">
            Nenhum sinal de risco nas contas verificadas.
          </p>
        </div>
      )}

      {avisos.map((a, i) => {
        const estilo = ESTILO[a.nivel];
        return (
          <div
            key={`${a.account_id}-${i}`}
            className={cn("rounded-lg border px-3.5 py-3", estilo.caixa)}
          >
            <div className="flex flex-wrap items-center gap-2">
              <AlertTriangle size={14} className={cn("shrink-0", estilo.texto)} />
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                  estilo.texto,
                )}
              >
                {estilo.rotulo}
              </span>
              <span className={cn("text-sm font-semibold", estilo.texto)}>{a.titulo}</span>
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">{a.detalhe}</p>
            <p className="mt-1.5 text-xs text-muted-foreground/80">
              <span className="font-medium text-foreground/70">{a.conta}</span>
              {a.dono ? ` · ${a.dono}` : ""}
              {a.quality_rating ? ` · qualidade ${a.quality_rating}` : ""}
            </p>
          </div>
        );
      })}
    </section>
  );
}
