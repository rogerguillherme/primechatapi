import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PremiumCardProps {
  children: ReactNode;
  className?: string;
  variant?: "default" | "revenue" | "ai" | "elevated";
  interactive?: boolean;
  onClick?: () => void;
}

/**
 * Stripe-like premium card with subtle multi-layer shadow.
 * Variants: default | revenue (green tint) | ai (purple tint) | elevated.
 */
export function PremiumCard({
  children,
  className,
  variant = "default",
  interactive = false,
  onClick,
}: PremiumCardProps) {
  const base = "rounded-2xl bg-card relative overflow-hidden transition-all duration-200";
  const shadow = variant === "elevated" ? "shadow-elevated" : "shadow-stripe";
  const variantBg =
    variant === "revenue"
      ? "before:absolute before:inset-0 before:gradient-revenue-soft before:pointer-events-none"
      : variant === "ai"
      ? "before:absolute before:inset-0 before:gradient-ai-soft before:pointer-events-none"
      : "";
  const interactiveStyles = interactive
    ? "cursor-pointer hover:shadow-stripe-hover hover:-translate-y-0.5"
    : "";

  return (
    <div
      onClick={onClick}
      className={cn(base, shadow, variantBg, interactiveStyles, className)}
    >
      <div className="relative">{children}</div>
    </div>
  );
}
