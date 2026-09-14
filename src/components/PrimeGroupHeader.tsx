import { LogOut, MessageCircle, UsersRound } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

/**
 * Cabeçalho do Prime Group — separado do AppHeader/MetrikHeader de
 * propósito, mesma razão dos dois: nada do resto do Prime Chat (seletor de
 * plataforma, busca de leads, navegação do Métrik) faz sentido aqui.
 */
export function PrimeGroupHeader() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="border-b border-border/60 bg-card/40 backdrop-blur">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2.5 h-16">
          <div className="w-8 h-8 rounded-lg bg-indigo-900 flex items-center justify-center shrink-0">
            <UsersRound size={16} className="text-white" />
          </div>
          <span className="text-lg font-display font-bold tracking-tight">Prime Group</span>

          <div className="ml-auto flex items-center gap-2 shrink-0">
            {user && (
              <span className="text-xs text-muted-foreground hidden lg:inline">{user.email}</span>
            )}

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
