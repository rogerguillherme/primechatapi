import { useMemo } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProfileScoreProps {
  followers: number;
  avgEngagement: number; // percentage 0-100
  postsCount: number;
  hasInsights: boolean;
  bioLength: number;
}

function computeScore({ followers, avgEngagement, postsCount, hasInsights, bioLength }: ProfileScoreProps) {
  let score = 0;
  // Engagement weight (40)
  if (avgEngagement >= 6) score += 40;
  else if (avgEngagement >= 3) score += 30;
  else if (avgEngagement >= 1.5) score += 20;
  else if (avgEngagement > 0) score += 10;
  // Followers weight (20)
  if (followers >= 50000) score += 20;
  else if (followers >= 10000) score += 15;
  else if (followers >= 1000) score += 10;
  else if (followers > 0) score += 5;
  // Consistency (20)
  if (postsCount >= 50) score += 20;
  else if (postsCount >= 20) score += 14;
  else if (postsCount >= 5) score += 8;
  // Bio quality (10)
  if (bioLength >= 80) score += 10;
  else if (bioLength >= 30) score += 6;
  // Insights (10)
  if (hasInsights) score += 10;
  return Math.min(100, score);
}

export function ProfileScore(props: ProfileScoreProps) {
  const score = useMemo(() => computeScore(props), [props]);
  const circumference = 2 * Math.PI * 56;
  const offset = circumference - (score / 100) * circumference;

  const grade =
    score >= 80 ? { label: "Excelente", color: "text-emerald-400", ring: "stroke-emerald-400", trend: TrendingUp, sub: "Perfil otimizado para crescer" } :
    score >= 60 ? { label: "Bom", color: "text-sky-400", ring: "stroke-sky-400", trend: TrendingUp, sub: "Algumas melhorias podem destravar" } :
    score >= 40 ? { label: "Regular", color: "text-amber-400", ring: "stroke-amber-400", trend: Minus, sub: "Existem oportunidades claras" } :
                  { label: "Crítico", color: "text-rose-400", ring: "stroke-rose-400", trend: TrendingDown, sub: "Precisa de ajustes urgentes" };

  const TrendIcon = grade.trend;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-card to-card/60 p-6 shadow-card">
      <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-gradient-to-br from-purple-500/20 to-pink-500/10 blur-3xl" />
      <div className="relative flex items-center gap-6">
        <div className="relative h-32 w-32 shrink-0">
          <svg className="h-full w-full -rotate-90" viewBox="0 0 128 128">
            <circle cx="64" cy="64" r="56" strokeWidth="10" className="fill-none stroke-muted" />
            <circle
              cx="64" cy="64" r="56" strokeWidth="10" strokeLinecap="round"
              className={cn("fill-none transition-all duration-1000", grade.ring)}
              strokeDasharray={circumference}
              strokeDashoffset={offset}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={cn("font-display text-4xl font-bold tracking-tight", grade.color)}>{score}</span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">/ 100</span>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Score do Perfil</p>
            <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold", grade.color, "bg-current/10")}>
              <TrendIcon className="h-3 w-3" /> {grade.label}
            </span>
          </div>
          <h2 className="mt-1 text-xl font-display font-bold text-foreground">{grade.sub}</h2>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed max-w-md">
            Calculado com base em engajamento, consistência, alcance e qualidade da bio. Atualizado em tempo real.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Pill label="Engajamento" value={`${props.avgEngagement.toFixed(1)}%`} good={props.avgEngagement >= 3} />
            <Pill label="Posts" value={String(props.postsCount)} good={props.postsCount >= 20} />
            <Pill label="Bio" value={props.bioLength >= 30 ? "OK" : "Curta"} good={props.bioLength >= 30} />
            <Pill label="Insights Meta" value={props.hasInsights ? "Ativos" : "Off"} good={props.hasInsights} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Pill({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium",
      good ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-400" : "border-amber-500/20 bg-amber-500/5 text-amber-400"
    )}>
      <span className="opacity-60">{label}</span>
      <span className="font-semibold">{value}</span>
    </span>
  );
}
