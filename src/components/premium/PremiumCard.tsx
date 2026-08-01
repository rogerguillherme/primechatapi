import { ReactNode, useRef } from "react";
import { cn } from "@/lib/utils";

interface PremiumCardProps {
  children: ReactNode;
  className?: string;
  variant?: "default" | "revenue" | "ai" | "elevated";
  interactive?: boolean;
  onClick?: () => void;
  /** Desativa o tilt 3D acompanhando o mouse. */
  flat?: boolean;
}

/**
 * Stripe-like premium card com profundidade 3D:
 * o cartão inclina suavemente acompanhando o ponteiro.
 * Variants: default | revenue (green tint) | ai (purple tint) | elevated.
 */
export function PremiumCard({
  children,
  className,
  variant = "default",
  interactive = false,
  onClick,
  flat = false,
}: PremiumCardProps) {
  const innerRef = useRef<HTMLDivElement>(null);

  const base = "rounded-2xl bg-card relative overflow-hidden";
  const shadow = variant === "elevated" ? "shadow-elevated" : "shadow-stripe";
  const variantBg =
    variant === "revenue"
      ? "before:absolute before:inset-0 before:gradient-revenue-soft before:pointer-events-none"
      : variant === "ai"
      ? "before:absolute before:inset-0 before:gradient-ai-soft before:pointer-events-none"
      : "";
  const interactiveStyles = interactive
    ? "cursor-pointer hover:shadow-stripe-hover"
    : "";

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = innerRef.current;
    if (!el || flat) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `rotateY(${px * 6}deg) rotateX(${-py * 6}deg) translateZ(14px)`;
  };

  const handleLeave = () => {
    const el = innerRef.current;
    if (el) el.style.transform = "";
  };

  return (
    <div className={cn("h-full", !flat && "scene-3d")}>
      <div
        ref={innerRef}
        onClick={onClick}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        className={cn(base, shadow, variantBg, interactiveStyles, !flat && "card-3d", className)}
      >
        <div className="relative">{children}</div>
      </div>
    </div>
  );
}
