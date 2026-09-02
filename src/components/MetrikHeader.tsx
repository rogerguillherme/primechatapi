import { LogOut, MessageCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { MetrikLogo } from "@/components/MetrikLogo";

/**
 * Cabeçalho do Metrik.
 *
 * Separado do AppHeader de propósito: aquele carrega o seletor de plataforma,
 * a busca de leads, o sino de notificações do chat e o aviso de saúde da WABA —
 * nada disso significa coisa alguma num painel de performance comercial, e
 * ícone que não faz sentido no contexto é ruído que ensina a ignorar a barra.
 *
 * O que os dois compartilham é o que de fato é comum: tema, sair, e a mesma
 * altura e proporção, para a troca entre os produtos não parecer um salto.
 */
export function MetrikHeader() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="bg-slate-900 text-white dark:bg-slate-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <button
            onClick={() => navigate("/metrik")}
            className="flex items-center gap-3 text-left"
            aria-label="Início do Metrik"
          >
            <div className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center">
              <MetrikLogo size={22} className="text-white" />
            </div>
            <div>
              <h1 className="text-base font-display font-bold tracking-tight">Metrik</h1>
              <p className="text-[11px] text-white/50 leading-none">Performance comercial</p>
            </div>
          </button>

          <div className="flex items-center gap-2">
            {user && (
              <span className="text-xs text-white/60 hidden sm:inline">{user.email}</span>
            )}

            {/* A volta para o chat é explícita e escrita. O caminho de ida é um
                ícone no cabeçalho de lá; sem o de volta, sair do Metrik viraria
                digitar a URL ou apertar o botão do navegador. */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/")}
              className="gap-1.5 text-white/60 hover:text-white hover:bg-white/10"
              title="Ir para o Prime Chat"
            >
              <MessageCircle size={15} />
              <span className="hidden sm:inline text-xs">Prime Chat</span>
            </Button>

            <ThemeToggle collapsed={true} />

            {user && (
              <Button
                variant="ghost"
                size="icon"
                onClick={signOut}
                className="text-white/60 hover:text-white hover:bg-white/10"
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
