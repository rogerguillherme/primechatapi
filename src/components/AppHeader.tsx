import { MessageCircle, LogOut, Users, Plug } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function AppHeader() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const { data: isAdmin } = useQuery({
    queryKey: ["user-role", user?.id],
    queryFn: async () => {
      if (!user) return false;
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();
      return !!data;
    },
    enabled: !!user,
  });

  return (
    <header className="gradient-header text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-whatsapp/20 flex items-center justify-center">
              <MessageCircle size={20} className="text-whatsapp" />
            </div>
            <div>
              <h1 className="text-base font-display font-bold tracking-tight">Prime Chat</h1>
              <p className="text-[11px] text-white/50 leading-none">Plataforma de Comunicação</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {user && (
              <span className="text-xs text-white/60 hidden sm:inline">{user.email}</span>
            )}
            {isAdmin && (
              <Button variant="ghost" size="icon" onClick={() => navigate("/connect")} className="text-white/60 hover:text-white hover:bg-white/10" title="Conexão WhatsApp">
                <Plug size={16} />
              </Button>
            )}
            {isAdmin && (
              <Button variant="ghost" size="icon" onClick={() => navigate("/admin/users")} className="text-white/60 hover:text-white hover:bg-white/10">
                <Users size={16} />
              </Button>
            )}
            <ThemeToggle collapsed={true} />
            {user && (
              <Button variant="ghost" size="icon" onClick={signOut} className="text-white/60 hover:text-white hover:bg-white/10">
                <LogOut size={16} />
              </Button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}