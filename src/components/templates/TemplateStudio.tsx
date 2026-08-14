import { useMemo } from "react";
import { TemplateManager } from "@/components/TemplateManager";
import { useUserTemplates } from "@/hooks/use-user-templates";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { CheckCircle2, Clock, XCircle, FileText, Sparkles } from "lucide-react";

interface StatusStat {
  label: string;
  value: number;
  icon: typeof CheckCircle2;
  tone: string;
}

/**
 * Central de templates: cria modelos, envia para aprovação da Meta e acompanha
 * o status de cada um com sincronização automática.
 */
export function TemplateStudio() {
  const { templates } = useUserTemplates();

  const stats = useMemo<StatusStat[]>(() => {
    const list = (templates ?? []) as Array<{ meta_status?: string | null }>;
    const count = (status: string) =>
      list.filter((t) => (t.meta_status || "unknown").toUpperCase() === status).length;

    return [
      { label: "Total", value: list.length, icon: FileText, tone: "text-foreground" },
      { label: "Aprovados", value: count("APPROVED"), icon: CheckCircle2, tone: "text-emerald-500" },
      { label: "Pendentes", value: count("PENDING"), icon: Clock, tone: "text-amber-500" },
      { label: "Rejeitados", value: count("REJECTED"), icon: XCircle, tone: "text-destructive" },
    ];
  }, [templates]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <FileText size={20} className="text-primary" />
        <div>
          <h2 className="text-lg font-semibold">Templates</h2>
          <p className="text-xs text-muted-foreground">
            Crie modelos de mensagem e envie para aprovação da Meta sem sair do app
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <s.icon size={14} className={s.tone} />
                {s.label}
              </div>
              <p className={cn("mt-1 text-2xl font-semibold", s.tone)}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="flex items-start gap-2 p-4 text-xs text-muted-foreground">
          <Sparkles size={14} className="mt-0.5 text-primary shrink-0" />
          <p>
            Crie o template, vincule às contas que vão usá-lo e clique em <strong>Enviar p/ Meta</strong>.
            A aprovação costuma sair em minutos e o status é atualizado automaticamente aqui.
          </p>
        </CardContent>
      </Card>

      <TemplateManager autoSync />
    </div>
  );
}
