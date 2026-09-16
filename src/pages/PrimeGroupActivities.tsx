import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity, Loader2, Megaphone, CalendarClock, Send, AlertCircle,
  RefreshCw, Users2, Info,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { type PgActivity } from "@/lib/prime-group";
import { Card } from "@/components/ui/card";

const ICONE: Record<string, { icon: typeof Activity; classe: string }> = {
  campanha_criada: { icon: Megaphone, classe: "bg-primary/10 text-primary" },
  agendada:        { icon: CalendarClock, classe: "bg-sky-500/10 text-sky-600" },
  envio:           { icon: Send, classe: "bg-emerald-500/10 text-emerald-600" },
  erro:            { icon: AlertCircle, classe: "bg-red-500/10 text-red-600" },
  grupo_sync:      { icon: RefreshCw, classe: "bg-violet-500/10 text-violet-600" },
  lead_sync:       { icon: Users2, classe: "bg-amber-500/10 text-amber-600" },
  info:            { icon: Info, classe: "bg-muted text-muted-foreground" },
};

/** Feed de atividades do módulo — lê pg_activities, agrupado por dia. */
export default function PrimeGroupActivities() {
  const { data: atividades = [], isLoading } = useQuery({
    queryKey: ["pg-activities"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("pg_activities").select("*").order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return (data ?? []) as PgActivity[];
    },
  });

  const porDia = useMemo(() => {
    const mapa = new Map<string, PgActivity[]>();
    for (const a of atividades) {
      const dia = new Date(a.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
      if (!mapa.has(dia)) mapa.set(dia, []);
      mapa.get(dia)!.push(a);
    }
    return Array.from(mapa.entries());
  }, [atividades]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold flex items-center gap-2">
          <Activity className="h-6 w-6 text-primary" /> Atividades
        </h1>
        <p className="text-sm text-muted-foreground">Tudo que acontece no Prime Group, em ordem</p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando…
        </div>
      ) : atividades.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">
          <Activity className="h-10 w-10 mx-auto text-muted-foreground/40" />
          <p className="mt-3">Nenhuma atividade ainda. Ela aparece aqui conforme você cria e agenda campanhas.</p>
        </Card>
      ) : (
        <div className="space-y-8">
          {porDia.map(([dia, itens]) => (
            <div key={dia}>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">{dia}</h2>
              <div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-1 before:bottom-1 before:w-px before:bg-border">
                {itens.map((a) => {
                  const cfg = ICONE[a.type] ?? ICONE.info;
                  const Icone = cfg.icon;
                  return (
                    <div key={a.id} className="relative">
                      <div className={`absolute -left-6 top-0 flex h-5 w-5 items-center justify-center rounded-full ${cfg.classe}`}>
                        <Icone className="h-3 w-3" />
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium leading-tight">{a.title}</p>
                          {a.detail && <p className="text-xs text-muted-foreground mt-0.5">{a.detail}</p>}
                        </div>
                        <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
                          {new Date(a.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
