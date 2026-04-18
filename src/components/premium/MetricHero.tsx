import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { PremiumCard } from "./PremiumCard";

interface MetricHeroProps {
  label: string;
  value: string;
  /** Delta vs comparison period, e.g. "+23%" or "-4%" */
  deltaPercent?: number | null;
  /** Comparison label, e.g. "vs ontem" */
  comparisonLabel?: string;
  /** Sub line shown below the value */
  hint?: string;
  variant?: "revenue" | "default";
  loading?: boolean;
}

export function MetricHero({
  label,
  value,
  deltaPercent,
  comparisonLabel,
  hint,
  variant = "revenue",
  loading,
}: MetricHeroProps) {
  const trend =
    deltaPercent === undefined || deltaPercent === null
      ? "flat"
      : deltaPercent > 0
      ? "up"
      : deltaPercent < 0
      ? "down"
      : "flat";

  const trendColor =
    trend === "up"
      ? "text-revenue bg-revenue/10"
      : trend === "down"
      ? "text-destructive bg-destructive/10"
      : "text-muted-foreground bg-muted";

  const TrendIcon = trend === "up" ? ArrowUp : trend === "down" ? ArrowDown : Minus;

  return (
    <PremiumCard variant={variant} className="p-6 sm:p-8">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs sm:text-sm font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          {trend !== "flat" && deltaPercent != null && (
            <div
              className={cn(
                "inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold tabular-nums",
                trendColor
              )}
            >
              <TrendIcon size={12} strokeWidth={3} />
              {Math.abs(deltaPercent).toFixed(0)}%
              {comparisonLabel && (
                <span className="font-normal opacity-80 ml-0.5">{comparisonLabel}</span>
              )}
            </div>
          )}
        </div>

        {loading ? (
          <div className="h-12 sm:h-14 w-48 bg-muted/60 animate-pulse rounded-lg" />
        ) : (
          <p className="text-4xl sm:text-5xl lg:text-6xl font-display font-bold tracking-tight tabular-nums leading-none">
            {value}
          </p>
        )}

        {hint && (
          <p className="text-xs sm:text-sm text-muted-foreground">{hint}</p>
        )}
      </div>
    </PremiumCard>
  );
}
