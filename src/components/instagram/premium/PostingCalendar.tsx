import { Fragment } from "react";
import { Clock, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

interface PostingCalendarProps {
  hourlyDistribution?: Record<string, number>; // "Mon-09" -> count
  isPremium?: boolean;
  onUpgrade?: () => void;
}

const DAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const HOURS = [6, 9, 12, 15, 18, 21];

export function PostingCalendar({ hourlyDistribution = {}, isPremium = false, onUpgrade }: PostingCalendarProps) {
  // Demo heatmap data when no real data
  const getValue = (day: number, hour: number) => {
    const k = `${day}-${hour}`;
    if (hourlyDistribution[k] != null) return hourlyDistribution[k];
    // synthetic suggestive pattern: better at lunch + evening
    const base = hour === 12 ? 70 : hour === 18 || hour === 21 ? 85 : 30;
    return base + ((day * 7 + hour) % 20);
  };

  return (
    <div className={cn("relative rounded-2xl border border-border bg-card p-5 overflow-hidden", !isPremium && "select-none")}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-emerald-500/20 to-teal-500/10 flex items-center justify-center">
            <Clock className="h-4 w-4 text-emerald-400" />
          </div>
          <div>
            <h3 className="text-sm font-display font-bold">Melhores horários para postar</h3>
            <p className="text-xs text-muted-foreground">Heatmap baseado em engajamento histórico</p>
          </div>
        </div>
      </div>

      <div className={cn("grid grid-cols-[auto_repeat(6,1fr)] gap-1.5", !isPremium && "blur-sm pointer-events-none")}>
        <div />
        {HOURS.map((h) => (
          <div key={h} className="text-[10px] text-muted-foreground text-center font-medium">{h}h</div>
        ))}
        {DAYS.map((day, dIdx) => (
          <Fragment key={day}>
            <div className="text-[10px] text-muted-foreground font-medium flex items-center">{day}</div>
            {HOURS.map((h) => {
              const v = getValue(dIdx, h);
              const intensity = Math.min(100, v) / 100;
              return (
                <div
                  key={`${day}-${h}`}
                  className="aspect-square rounded-md transition-transform hover:scale-110"
                  style={{
                    background: `linear-gradient(135deg, hsl(152 70% ${20 + intensity * 35}%), hsl(160 60% ${15 + intensity * 30}%))`,
                  }}
                  title={`${day} ${h}h — score ${Math.round(v)}`}
                />
              );
            })}
          </Fragment>
        ))}
      </div>

      {!isPremium && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-card/40 backdrop-blur-[2px]">
          <div className="rounded-xl border border-purple-500/30 bg-gradient-to-br from-purple-950/80 to-pink-950/60 px-5 py-4 text-center shadow-elevated max-w-xs">
            <Lock className="h-6 w-6 mx-auto text-purple-300 mb-2" />
            <p className="text-sm font-display font-bold text-white">Desbloqueie horários ideais</p>
            <p className="text-[11px] text-purple-200 mt-1">Análise IA dos seus melhores horários e dias</p>
            <button
              onClick={onUpgrade}
              className="mt-3 w-full rounded-lg bg-gradient-to-r from-purple-500 to-pink-500 px-3 py-2 text-xs font-bold text-white hover:opacity-90 transition-opacity"
            >
              Upgrade para Pro
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
