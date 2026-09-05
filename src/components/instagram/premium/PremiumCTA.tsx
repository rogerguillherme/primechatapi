import { Sparkles, Check, Zap } from "lucide-react";

interface PremiumCTAProps {
  onUpgrade?: () => void;
}

export function PremiumCTA({ onUpgrade }: PremiumCTAProps) {
  const features = [
    "Análise IA ilimitada do seu perfil",
    "Relatório PDF white-label para clientes",
    "Comparação com até 5 concorrentes",
    "Calendário de conteúdo gerado por IA",
    "Automações Instagram → WhatsApp",
    "Sugestões de Reels virais semanais",
  ];

  return (
    <div className="relative overflow-hidden rounded-2xl border border-purple-500/30 bg-gradient-to-br from-purple-950/40 via-pink-950/30 to-orange-950/20 p-6">
      <div className="absolute -top-12 -right-12 h-48 w-48 rounded-full bg-gradient-to-br from-purple-500/30 to-pink-500/20 blur-3xl" />
      <div className="absolute -bottom-12 -left-12 h-48 w-48 rounded-full bg-gradient-to-br from-orange-500/20 to-pink-500/10 blur-3xl" />

      <div className="relative grid md:grid-cols-2 gap-6 items-center">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 backdrop-blur px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-purple-200">
            <Sparkles className="h-3 w-3" /> Insta Prime Pro
          </span>
          <h3 className="mt-3 text-2xl font-display font-bold text-white tracking-tight">
            Transforme métricas em <span className="bg-gradient-to-r from-purple-300 to-pink-300 bg-clip-text text-transparent">clientes pagantes</span>
          </h3>
          <p className="mt-2 text-sm text-purple-100/70 leading-relaxed">
            Pare de adivinhar. Use IA para diagnosticar, otimizar e escalar seu Instagram com dados de mercado.
          </p>
          <div className="mt-4 flex flex-wrap items-baseline gap-2">
            <span className="text-3xl font-display font-bold text-white">R$ 97</span>
            <span className="text-sm text-purple-200/70">/mês</span>
            <span className="text-xs line-through text-purple-300/40">R$ 197</span>
            <span className="rounded-md bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">-50% lançamento</span>
          </div>
          <button
            onClick={onUpgrade}
            className="mt-4 group inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 px-5 py-3 text-sm font-bold text-white shadow-elevated hover:shadow-2xl hover:scale-[1.02] transition-all"
          >
            <Zap className="h-4 w-4" /> Fazer upgrade agora
          </button>
          <p className="mt-2 text-[11px] text-purple-200/60">7 dias grátis • Cancele quando quiser</p>
        </div>

        <ul className="space-y-2.5">
          {features.map((f) => (
            <li key={f} className="flex items-start gap-2.5 text-sm text-purple-50">
              <span className="mt-0.5 h-4 w-4 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
                <Check className="h-2.5 w-2.5 text-emerald-300" />
              </span>
              {f}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
