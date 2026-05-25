import { MessageCircle, LogOut, Users, Plug, Instagram } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/contexts/AuthContext";
import { usePlatform, Platform } from "@/contexts/PlatformContext";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { NotificationBell } from "@/components/NotificationBell";
import { GlobalSearch } from "@/components/GlobalSearch";
import { WabaHealthBanner } from "@/components/WabaHealthBanner";

export function AppHeader() {
  const { user, signOut } = useAuth();
  const { platform, setPlatform } = usePlatform();
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

  const handlePlatformSwitch = (p: Platform) => {
    setPlatform(p);
    if (p === "instagram") {
      navigate("/instagram");
    } else {
      navigate("/");
    }
  };

  return (
    <header className="gradient-header text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center">
                {platform === "whatsapp" ? (
                  <MessageCircle size={20} className="text-whatsapp" />
                ) : (
                  <Instagram size={20} className="text-pink-400" />
                )}
              </div>
              <div>
                <h1 className="text-base font-display font-bold tracking-tight">Prime Chat</h1>
                <p className="text-[11px] text-white/50 leading-none">Plataforma de Comunicação</p>
              </div>
            </div>

            {/* Platform selector */}
            <div className="flex items-center bg-white/10 rounded-lg p-0.5 ml-4">
              <button
                onClick={() => handlePlatformSwitch("whatsapp")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                  platform === "whatsapp"
                    ? "bg-white/20 text-white shadow-sm"
                    : "text-white/50 hover:text-white/80"
                )}
              >
                <MessageCircle size={14} />
                WhatsApp
              </button>
              <button
                onClick={() => handlePlatformSwitch("instagram")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                  platform === "instagram"
                    ? "bg-white/20 text-white shadow-sm"
                    : "text-white/50 hover:text-white/80"
                )}
              >
                <Instagram size={14} />
                Instagram
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <GlobalSearch />
            {user && (
              <span className="text-xs text-white/60 hidden sm:inline">{user.email}</span>
            )}
            {user && <NotificationBell />}
            {user && platform === "whatsapp" && (
              <Button variant="ghost" size="icon" onClick={() => navigate("/auth/meta/callback")} className="text-white/60 hover:text-white hover:bg-white/10" title="Conexão WhatsApp">
                <Plug size={16} />
              </Button>
            )}
            {user?.email === "admin@primechat.com" && (
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
      <WabaHealthBanner />
    </header>
  );
}
