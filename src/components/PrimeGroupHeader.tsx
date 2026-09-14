import { LogOut, MessageCircle, UsersRound } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

/**
 * Cabeçalho do Prime Group — mesmo estilo/cores do AppHeader do Prime Chat
 * (gradient-header, ícone em caixa branca translúcida), só com a navegação
 * trocada: nada do resto do Prime Chat (seletor de plataforma, busca de
 * leads, sino do chat) faz sentido aqui.
 */
export function PrimeGroupHeader() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="gradient-header text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center">
              <UsersRound size={20} className="text-whatsapp" />
            </div>
            <div>
              <h1 className="text-base font-display font-bold tracking-tight">Prime Group</h1>
              <p className="text-[11px] text-white/50 leading-none">Grupos WhatsApp em escala</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {user && (
              <span className="text-xs text-white/50 hidden lg:inline">{user.email}</span>
            )}

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
