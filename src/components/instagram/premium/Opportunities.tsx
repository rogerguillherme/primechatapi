import { ArrowRight, AlertTriangle, Lightbulb, Sparkles, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

interface Opportunity {
  id: string;
  severity: "high" | "medium" | "low";
  title: string;
  description: string;
  action: string;
  premium?: boolean;
}

interface OpportunitiesProps {
  opportunities: Opportunity[];
  onUpgrade?: () => void;
  lockedPremium?: boolean;
}

export function Opportunities({ opportunities, onUpgrade, lockedPremium = true }: OpportunitiesProps) {
  if (opportunities.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-center">
        <Sparkles className="mx-auto h-8 w-8 text-muted-foreground/40" />
        <p className="mt-2 text-sm text-muted-foreground">Tudo otimizado por aqui ✨</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between p-5 border-b border-border">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-amber-500/20 to-orange-500/10 flex items-center justify-center">
            <Lightbulb className="h-4 w-4 text-amber-400" />
          </div>
          <div>
            <h3 className="text-sm font-display font-bold">Oportunidades detectadas</h3>
            <p className="text-xs text-muted-foreground">Ações priorizadas para acelerar o crescimento</p>
          </div>
        </div>
        <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-400">
          {opportunities.length}
        </span>
      </div>
      <ul className="divide-y divide-border">
        {opportunities.map((op) => (
          <li key={op.id} className="group p-4 hover:bg-muted/30 transition-colors">
            <div className="flex items-start gap-3">
              <div className={cn(
                "mt-0.5 h-2 w-2 rounded-full shrink-0",
                op.severity === "high" && "bg-rose-400",
                op.severity === "medium" && "bg-amber-400",
                op.severity === "low" && "bg-sky-400",
              )} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-semibold text-foreground">{op.title}</h4>
                  {op.premium && lockedPremium && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-gradient-to-r from-purple-500/20 to-pink-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-purple-300">
                      <Lock className="h-2.5 w-2.5" /> Pro
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">{op.description}</p>
                <button
                  onClick={op.premium && lockedPremium ? onUpgrade : undefined}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-purple-400 hover:text-purple-300 transition-colors"
                >
                  {op.action} <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function buildOpportunities(args: {
  avgEngagement: number;
  followers: number;
  postsCount: number;
  bioLength: number;
  hasInsights: boolean;
  hasReels: boolean;
}): Opportunity[] {
  const list: Opportunity[] = [];
  if (args.avgEngagement < 2) {
    list.push({
      id: "eng-low",
      severity: "high",
      title: "Engajamento abaixo do ideal",
      description: "Sua taxa está abaixo de 2%. Posts com perguntas e CTAs nos primeiros segundos elevam de 3-5x.",
      action: "Ver template de legenda",
    });
  }
  if (args.bioLength < 30) {
    list.push({
      id: "bio-short",
      severity: "medium",
      title: "Bio com pouca conversão",
      description: "Bios curtas perdem cliques no link. Use proposta de valor + CTA + link rastreado.",
      action: "Otimizar bio com IA",
      premium: true,
    });
  }
  if (!args.hasReels) {
    list.push({
      id: "no-reels",
      severity: "high",
      title: "Você não está postando Reels",
      description: "Reels têm 22% mais alcance médio que estáticos. Comece com 3 reels/semana de 7-15s.",
      action: "Ver ideias de Reels virais",
      premium: true,
    });
  }
  if (args.postsCount < 20) {
    list.push({
      id: "low-posts",
      severity: "medium",
      title: "Pouca consistência de postagem",
      description: "Perfis com menos de 20 posts entregam menos. O algoritmo prioriza contas ativas.",
      action: "Gerar calendário 30 dias",
      premium: true,
    });
  }
  if (!args.hasInsights) {
    list.push({
      id: "no-insights",
      severity: "low",
      title: "Insights Meta indisponíveis",
      description: "Ative Insights na sua conta Business para liberar dados de alcance e impressões.",
      action: "Como ativar",
    });
  }
  list.push({
    id: "wpp-funnel",
    severity: "high",
    title: "Funil Instagram → WhatsApp não configurado",
    description: "Conecte automações de DM para capturar leads e transformar comentários em vendas.",
    action: "Ativar funil de vendas",
    premium: true,
  });
  return list;
}
