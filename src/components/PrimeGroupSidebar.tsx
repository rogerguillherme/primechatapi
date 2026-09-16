import {
  LayoutGrid, Smartphone, Megaphone, History, Activity, Users2, Settings,
  MessageCircle, LogOut, UsersRound,
} from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";

import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

const NAV = [
  { rota: "/prime-group", rotulo: "Dashboard", icone: LayoutGrid, pronto: true },
  { rota: "/prime-group/instancias", rotulo: "Instâncias", icone: Smartphone, pronto: true },
  { rota: "/prime-group/campanha", rotulo: "Campanha", icone: Megaphone, pronto: true },
  { rota: "/prime-group/historico", rotulo: "Histórico", icone: History, pronto: true },
  { rota: "/prime-group/atividades", rotulo: "Atividades", icone: Activity, pronto: true },
  { rota: "/prime-group/leads", rotulo: "Leads", icone: Users2, pronto: true },
  { rota: "/prime-group/configuracoes", rotulo: "Configurações", icone: Settings, pronto: true },
];

/**
 * Sidebar do Prime Group — mesmo tratamento visual da sidebar do Prime Chat
 * (glass-sidebar, tokens sidebar-*), já que aqui a navegação principal do
 * produto é por páginas (rotas), não por abas como no chat.
 */
export function PrimeGroupSidebar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user, signOut } = useAuth();

  return (
    <aside className="glass-sidebar w-60 shrink-0 flex flex-col min-h-screen">
      <div className="relative p-4 border-b border-white/10 flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-whatsapp/20 flex items-center justify-center shrink-0">
          <UsersRound size={16} className="text-whatsapp" />
        </div>
        <div>
          <h1 className="text-sm font-display font-bold text-white">Prime Group</h1>
          <p className="text-[10px] text-white/50 leading-none">WhatsApp em escala</p>
        </div>
      </div>

      <nav className="flex-1 p-2 space-y-0.5">
        {NAV.map((item) => {
          const ativo = pathname === item.rota;
          return (
            <button
              key={item.rota}
              onClick={() => item.pronto && navigate(item.rota)}
              disabled={!item.pronto}
              title={item.pronto ? undefined : "Em breve"}
              className={cn(
                "w-full flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition-all",
                ativo
                  ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                  : item.pronto
                    ? "text-sidebar-foreground hover:bg-sidebar-accent"
                    : "text-sidebar-foreground/30 cursor-not-allowed",
              )}
            >
              <item.icone size={16} />
              {item.rotulo}
              {!item.pronto && <span className="ml-auto text-[9px] uppercase tracking-wide">Em breve</span>}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-white/10 p-2 space-y-0.5">
        {user && <p className="px-3 py-1 text-[10px] text-white/40 truncate">{user.email}</p>}
        <button
          onClick={() => navigate("/")}
          className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
        >
          <MessageCircle size={16} /> Prime Chat
        </button>
        <button
          onClick={signOut}
          className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
        >
          <LogOut size={16} /> Sair
        </button>
      </div>
    </aside>
  );
}
