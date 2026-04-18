import { Lock, Sparkles } from "lucide-react";
import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type PlanTier = "starter" | "pro" | "scale" | "white_label";

const tierLabel: Record<PlanTier, string> = {
  starter: "Starter",
  pro: "Pro",
  scale: "Scale",
  white_label: "White Label",
};

interface PlanLockBadgeProps {
  requiredPlan: PlanTier;
  className?: string;
}

/** Inline badge shown next to feature names that require an upgrade. */
export function PlanLockBadge({ requiredPlan, className }: PlanLockBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold gradient-ai text-ai-foreground",
        className
      )}
      title={`Disponível no plano ${tierLabel[requiredPlan]}`}
    >
      <Lock size={9} strokeWidth={3} />
      {tierLabel[requiredPlan]}
    </span>
  );
}

interface PlanLockOverlayProps {
  requiredPlan: PlanTier;
  children: ReactNode;
  /** When true, renders content with a blur+lock overlay. */
  locked: boolean;
  onUpgradeClick?: () => void;
}

/** Wraps a feature; when locked, blurs content and shows upgrade CTA. */
export function PlanLockOverlay({
  requiredPlan,
  children,
  locked,
  onUpgradeClick,
}: PlanLockOverlayProps) {
  if (!locked) return <>{children}</>;
  return (
    <div className="relative rounded-2xl overflow-hidden">
      <div className="pointer-events-none select-none filter blur-sm opacity-50">
        {children}
      </div>
      <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-sm">
        <div className="text-center px-6 py-5 max-w-sm">
          <div className="w-12 h-12 mx-auto rounded-2xl gradient-ai flex items-center justify-center mb-3">
            <Sparkles size={22} className="text-ai-foreground" />
          </div>
          <h4 className="font-display font-semibold text-base mb-1">
            Recurso do plano {tierLabel[requiredPlan]}
          </h4>
          <p className="text-sm text-muted-foreground mb-4">
            Faça upgrade para desbloquear e turbinar suas vendas.
          </p>
          <button
            onClick={onUpgradeClick}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg gradient-ai text-ai-foreground text-sm font-semibold shadow-elevated hover:opacity-90 transition-opacity"
          >
            <Sparkles size={14} />
            Ver planos
          </button>
        </div>
      </div>
    </div>
  );
}
