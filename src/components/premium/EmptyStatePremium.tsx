import { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface EmptyStatePremiumProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  variant?: "default" | "subtle";
  className?: string;
}

export function EmptyStatePremium({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  variant = "default",
  className,
}: EmptyStatePremiumProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center px-6 py-12 rounded-2xl",
        variant === "default" && "bg-surface-subtle border border-dashed border-border/60",
        className
      )}
    >
      <div className="w-14 h-14 rounded-2xl gradient-revenue-soft border border-border/40 flex items-center justify-center mb-4">
        <Icon size={26} className="text-revenue" strokeWidth={1.8} />
      </div>
      <h3 className="font-display font-semibold text-base mb-1.5">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-sm">{description}</p>
      {actionLabel && onAction && (
        <Button onClick={onAction} className="mt-5 gap-1.5" size="sm">
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
