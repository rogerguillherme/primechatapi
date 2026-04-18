import { Send, MessageCircle, ShoppingCart, Sparkles } from "lucide-react";
import { PremiumCard } from "@/components/premium/PremiumCard";

interface Action {
  label: string;
  description: string;
  icon: any;
  onClick: () => void;
  accent: "primary" | "ai" | "revenue" | "warning";
}

const accentMap = {
  primary: "bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground",
  ai: "bg-ai/10 text-ai group-hover:bg-ai group-hover:text-ai-foreground",
  revenue: "bg-revenue/10 text-revenue group-hover:bg-revenue group-hover:text-revenue-foreground",
  warning: "bg-warning/10 text-warning group-hover:bg-warning group-hover:text-warning-foreground",
};

interface QuickActionsProps {
  onNavigate: (tab: string) => void;
}

export function QuickActions({ onNavigate }: QuickActionsProps) {
  const actions: Action[] = [
    {
      label: "Nova campanha",
      description: "Dispare em massa",
      icon: Send,
      accent: "primary",
      onClick: () => onNavigate("broadcast"),
    },
    {
      label: "Responder leads",
      description: "Inbox de conversas",
      icon: MessageCircle,
      accent: "revenue",
      onClick: () => onNavigate("chat"),
    },
    {
      label: "Configurar agente IA",
      description: "Atendimento 24/7",
      icon: Sparkles,
      accent: "ai",
      onClick: () => onNavigate("ai-agent"),
    },
    {
      label: "Recuperar carrinho",
      description: "Templates prontos",
      icon: ShoppingCart,
      accent: "warning",
      onClick: () => onNavigate("broadcast"),
    },
  ];

  return (
    <PremiumCard className="p-5">
      <div className="mb-4">
        <h3 className="font-display font-semibold text-sm">Ações rápidas</h3>
        <p className="text-[11px] text-muted-foreground mt-0.5">Atalhos para o que mais usa</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {actions.map((a) => (
          <button
            key={a.label}
            onClick={a.onClick}
            className="group flex items-start gap-3 p-3 rounded-xl border border-border/60 bg-surface-elevated hover:shadow-card-hover hover:border-primary/30 transition-all text-left"
          >
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors ${accentMap[a.accent]}`}>
              <a.icon size={16} strokeWidth={2.2} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold leading-tight">{a.label}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{a.description}</p>
            </div>
          </button>
        ))}
      </div>
    </PremiumCard>
  );
}
