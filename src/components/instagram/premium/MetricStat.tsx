import { LucideIcon, ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

interface MetricStatProps {
  label: string;
  value: string;
  icon: LucideIcon;
  delta?: number; // percentage change
  hint?: string;
  loading?: boolean;
  accent?: "purple" | "emerald" | "sky" | "amber" | "pink";
}

const ACCENTS = {
  purple: { ring: "from-purple-500/20 to-purple-500/5", icon: "text-purple-400" },
  emerald: { ring: "from-emerald-500/20 to-emerald-500/5", icon: "text-emerald-400" },
  sky: { ring: "from-sky-500/20 to-sky-500/5", icon: "text-sky-400" },
  amber: { ring: "from-amber-500/20 to-amber-500/5", icon: "text-amber-400" },
  pink: { ring: "from-pink-500/20 to-pink-500/5", icon: "text-pink-400" },
};

export function MetricStat({ label, value, icon: Icon, delta, hint, loading, accent = "purple" }: MetricStatProps) {
  const a = ACCENTS[accent];
  const positive = (delta ?? 0) >= 0;
  return (
    <div className="group relative overflow-hidden rounded-xl border border-border bg-card p-4 transition-all hover:shadow-card-hover hover:border-border/80">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold truncate">{label}</p>
          {loading ? (
            <Skeleton className="h-7 w-20 mt-1.5" />
          ) : (
            <p className="mt-1 font-display text-2xl font-bold text-foreground tracking-tight">{value}</p>
          )}
          <div className="mt-1 flex items-center gap-1.5 text-[11px]">
            {delta != null && (
              <span className={cn(
                "inline-flex items-center gap-0.5 font-semibold",
                positive ? "text-emerald-400" : "text-rose-400"
              )}>
                {positive ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                {Math.abs(delta).toFixed(1)}%
              </span>
            )}
            {hint && <span className="text-muted-foreground truncate">{hint}</span>}
          </div>
        </div>
        <div className={cn("h-9 w-9 rounded-lg bg-gradient-to-br flex items-center justify-center shrink-0", a.ring)}>
          <Icon className={cn("h-4 w-4", a.icon)} />
        </div>
      </div>
    </div>
  );
}
