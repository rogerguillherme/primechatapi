import {
  LogOut, MessageCircle, LayoutGrid, Trophy, DollarSign,
  Contact, Users, Flag, Wallet, Plug, Settings,
} from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";

import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { MetrikLogo } from "@/components/MetrikLogo";
import { cn } from "@/lib/utils";

/**
 * Cabeçalho e navegação do Métrik.
 *
 * Separado do AppHeader de propósito: aquele carrega seletor de plataforma,
 * busca de leads, sino do chat e aviso de saúde da WABA — nada disso significa
 * coisa alguma num painel de performance, e ícone sem sentido no contexto é
 * ruído que ensina a ignorar a barra inteira.
 *
 * As sete seções do painel de referência. Todas abrem com dado real: nenhuma é
 * casca esperando conteúdo, porque aba que abre vazia ensina que clicar não
 * leva a lugar nenhum.
 */
const SECOES = [
  { rota: "/metrik", rotulo: "Dashboard", icone: LayoutGrid },
  { rota: "/metrik/ranking", rotulo: "Ranking", icone: Trophy },
  { rota: "/metrik/vendas", rotulo: "Vendas", icone: DollarSign },
  { rota: "/metrik/clientes", rotulo: "Clientes", icone: Contact },
  { rota: "/metrik/vendedores", rotulo: "Vendedores", icone: Users },
  { rota: "/metrik/metas", rotulo: "Metas", icone: Flag },
  { rota: "/metrik/comissionados", rotulo: "Comissionados", icone: Wallet },
  { rota: "/metrik/integracoes", rotulo: "Integrações", icone: Plug },
  { rota: "/metrik/configuracoes", rotulo: "Configurações", icone: Settings },
];

export function MetrikHeader() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <header className="border-b border-border/60 bg-card/40 backdrop-blur">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-6 h-16">
          <button
            onClick={() => navigate("/metrik")}
            className="flex items-center gap-2.5 shrink-0 text-left"
            aria-label="Início do Métrik"
          >
            <MetrikLogo size={26} className="text-foreground" />
            <span className="text-lg font-display font-bold tracking-tight">Métrik</span>
          </button>

          <nav className="flex items-center gap-1 overflow-x-auto">
            {SECOES.map((s) => {
              const ativo = pathname === s.rota;
              return (
                <button
                  key={s.rota}
                  onClick={() => navigate(s.rota)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
                    ativo
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent",
                  )}
                >
                  <s.icone size={15} />
                  {s.rotulo}
                </button>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2 shrink-0">
            {user && (
              <span className="text-xs text-muted-foreground hidden lg:inline">{user.email}</span>
            )}

            {/* A volta é escrita, não só um ícone: o caminho de ida é um atalho
                no cabeçalho do chat, e sem o de volta sair daqui viraria
                digitar URL. */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/")}
              className="gap-1.5 text-muted-foreground hover:text-foreground"
              title="Ir para o Prime Chat"
            >
              <MessageCircle size={15} />
              <span className="hidden sm:inline text-xs">Prime Chat</span>
            </Button>

            {user && (
              <Button
                variant="ghost"
                size="icon"
                onClick={signOut}
                className="text-muted-foreground hover:text-foreground"
                title="Sair"
              >
                <LogOut size={16} />
              </Button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
