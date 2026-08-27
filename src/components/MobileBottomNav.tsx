import { Home, MessageSquare, Send, Columns3, Menu } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MobileBottomNavProps {
  /** Aba principal ativa no shell (mesmos valores das TabsTrigger). */
  active: string;
  /** Troca a aba principal. */
  onNavigate: (tab: string) => void;
  /** Abre a gaveta com o menu completo (todas as seções). */
  onOpenMenu: () => void;
  /** Some quando uma conversa está aberta, para o chat ocupar a tela toda. */
  hidden?: boolean;
}

const ITEMS = [
  { tab: "home", label: "Início", icon: Home },
  { tab: "chat", label: "Chat", icon: MessageSquare },
  { tab: "broadcast", label: "Disparos", icon: Send },
  { tab: "kanban", label: "Kanban", icon: Columns3 },
] as const;

/**
 * Barra de navegação inferior, só no celular — o padrão de app nativo.
 * O menu lateral completo continua acessível pelo último botão, porque as
 * seções de análise e configuração não caberiam aqui.
 */
export function MobileBottomNav({ active, onNavigate, onOpenMenu, hidden }: MobileBottomNavProps) {
  if (hidden) return null;

  return (
    <nav
      aria-label="Navegação principal"
      className="md:hidden shrink-0 glass-sidebar border-t border-white/10 pb-[env(safe-area-inset-bottom)]"
    >
      <div className="relative grid grid-cols-5">
        {ITEMS.map(({ tab, label, icon: Icon }) => {
          const isActive = active === tab;
          return (
            <button
              key={tab}
              type="button"
              aria-current={isActive ? "page" : undefined}
              onClick={() => onNavigate(tab)}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors",
                isActive ? "text-primary" : "text-white/55 hover:text-white/85",
              )}
            >
              <span
                className={cn(
                  "flex h-7 w-12 items-center justify-center rounded-full transition-colors",
                  isActive && "bg-primary/15",
                )}
              >
                <Icon size={18} />
              </span>
              {label}
            </button>
          );
        })}

        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Abrir menu completo"
          className="flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium text-white/55 hover:text-white/85 transition-colors"
        >
          <span className="flex h-7 w-12 items-center justify-center rounded-full">
            <Menu size={18} />
          </span>
          Menu
        </button>
      </div>
    </nav>
  );
}
