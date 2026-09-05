import { Sparkles, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Insight {
  id: string;
  icon?: string; // emoji
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  severity?: "info" | "opportunity" | "warning";
}

interface InsightCardProps {
  insight: Insight;
}

const severityStyles: Record<NonNullable<Insight["severity"]>, string> = {
  info: "border-l-ai",
  opportunity: "border-l-revenue",
  warning: "border-l-warning",
};

export function InsightCard({ insight }: InsightCardProps) {
  const severity = insight.severity ?? "info";
  return (
    <div
      className={cn(
        "group flex items-start gap-3 p-4 rounded-xl bg-surface-elevated border border-border/60 border-l-4 transition-all hover:shadow-card-hover",
        severityStyles[severity]
      )}
    >
      <div className="text-xl shrink-0 leading-none mt-0.5" aria-hidden>
        {insight.icon ?? "✨"}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm text-foreground leading-tight">{insight.title}</p>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{insight.description}</p>
        {insight.actionLabel && insight.onAction && (
          <button
            onClick={insight.onAction}
            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-ai hover:gap-1.5 transition-all"
          >
            {insight.actionLabel}
            <ArrowRight size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

export function InsightCardSkeleton() {
  return (
    <div className="flex items-start gap-3 p-4 rounded-xl bg-surface-elevated border border-border/60 border-l-4 border-l-muted">
      <div className="w-5 h-5 rounded bg-muted animate-pulse shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 bg-muted animate-pulse rounded w-3/4" />
        <div className="h-3 bg-muted animate-pulse rounded w-full" />
        <div className="h-3 bg-muted animate-pulse rounded w-2/3" />
      </div>
    </div>
  );
}

export function InsightsHeader() {
  return (
    <div className="flex items-center gap-2">
      <div className="w-7 h-7 rounded-lg gradient-ai flex items-center justify-center">
        <Sparkles size={14} className="text-ai-foreground" />
      </div>
      <div>
        <h3 className="font-display font-semibold text-sm">Insights da IA</h3>
        <p className="text-[11px] text-muted-foreground leading-none mt-0.5">
          Análise automática do seu negócio
        </p>
      </div>
    </div>
  );
}
