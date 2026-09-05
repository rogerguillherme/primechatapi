import { Eye, Heart, MessageSquare, MessageCircle, ShoppingCart } from "lucide-react";
import { cn } from "@/lib/utils";

interface FunnelProps {
  reach: number;
  engagement: number;
  comments: number;
  dms?: number;
  conversions?: number;
}

function fmt(n: number) {
  if (!n) return "0";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString("pt-BR");
}

export function InstagramFunnel({ reach, engagement, comments, dms = 0, conversions = 0 }: FunnelProps) {
  const steps = [
    { label: "Alcance", value: reach, icon: Eye, color: "from-sky-500 to-sky-400", width: 100 },
    { label: "Engajamento", value: engagement, icon: Heart, color: "from-purple-500 to-purple-400", width: reach ? Math.max(20, (engagement / reach) * 100) : 80 },
    { label: "Comentários", value: comments, icon: MessageSquare, color: "from-pink-500 to-pink-400", width: reach ? Math.max(15, (comments / reach) * 200) : 60 },
    { label: "DMs / Leads", value: dms, icon: MessageCircle, color: "from-orange-500 to-orange-400", width: 40 },
    { label: "Conversões WhatsApp", value: conversions, icon: ShoppingCart, color: "from-emerald-500 to-emerald-400", width: 25 },
  ];

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-display font-bold">Funil Instagram → WhatsApp</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Da descoberta até a venda — visualize cada etapa</p>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider text-purple-400 bg-purple-500/10 px-2 py-1 rounded-md">Beta</span>
      </div>
      <div className="space-y-2">
        {steps.map((s) => (
          <div key={s.label} className="group flex items-center gap-3">
            <div className="flex items-center gap-2 w-44 shrink-0">
              <s.icon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{s.label}</span>
            </div>
            <div className="flex-1 relative h-9 rounded-lg bg-muted/50 overflow-hidden">
              <div
                className={cn("h-full rounded-lg bg-gradient-to-r transition-all duration-700", s.color)}
                style={{ width: `${Math.min(100, s.width)}%` }}
              />
              <span className="absolute inset-0 flex items-center px-3 text-xs font-bold text-foreground mix-blend-difference">
                {fmt(s.value)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
