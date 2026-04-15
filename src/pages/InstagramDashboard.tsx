import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { InstagramChat } from "@/components/instagram/InstagramChat";
import { InstagramAutomations } from "@/components/instagram/InstagramAutomations";
import { InstagramMetrics } from "@/components/instagram/InstagramMetrics";
import { InstagramSettings } from "@/components/instagram/InstagramSettings";
import { cn } from "@/lib/utils";
import {
  MessageSquare, Zap, BarChart3, Settings, Instagram, MessageCircle,
  ChevronLeft, ChevronRight, LogOut, Users, Plug,
} from "lucide-react";

export default function InstagramDashboard() {
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get("tab") || "chat";
  const [activeTab, setActiveTab] = useState(initialTab);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab && ["chat", "automations", "metrics", "settings"].includes(tab)) {
      setActiveTab(tab);
    }
  }, [searchParams]);
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

  const navItems = [
    { id: "chat", icon: MessageSquare, label: "Chat" },
    { id: "automations", icon: Zap, label: "Automações" },
    { id: "metrics", icon: BarChart3, label: "Métricas" },
    { id: "settings", icon: Settings, label: "Configuração" },
  ];

  return (
    <div className="animate-fade-in flex h-screen">
      {/* Sidebar */}
      <div className={cn("shrink-0 border-r border-sidebar-border gradient-instagram flex flex-col transition-all duration-300", sidebarCollapsed ? "w-14" : "w-56")}>
        <div className="p-3 border-b border-sidebar-border flex items-center justify-between">
          {!sidebarCollapsed && (
            <div className="flex items-center gap-2.5 animate-fade-in">
              <div className="w-8 h-8 rounded-lg bg-pink-500/20 flex items-center justify-center">
                <Instagram size={16} className="text-pink-400" />
              </div>
              <div>
                <h1 className="text-sm font-display font-bold text-white">Insta Prime</h1>
                <p className="text-[10px] text-white/50 leading-none">Instagram</p>
              </div>
            </div>
          )}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-1.5 rounded-md text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
          >
            {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>

        {/* Platform selector */}
        <div className="px-2 pt-2 pb-1">
          <div className={cn("flex items-center rounded-lg bg-white/10 p-0.5", sidebarCollapsed ? "flex-col gap-0.5" : "")}>
            <button
              onClick={() => navigate("/")}
              className={cn(
                "flex items-center gap-1.5 rounded-md text-xs font-medium transition-all text-white/50 hover:text-white/80",
                sidebarCollapsed ? "p-1.5 w-full justify-center" : "flex-1 px-2.5 py-1.5 justify-center"
              )}
            >
              <MessageCircle size={13} />
              {!sidebarCollapsed && "WhatsApp"}
            </button>
            <button
              className={cn(
                "flex items-center gap-1.5 rounded-md text-xs font-medium transition-all bg-white/20 text-white shadow-sm",
                sidebarCollapsed ? "p-1.5 w-full justify-center" : "flex-1 px-2.5 py-1.5 justify-center"
              )}
            >
              <Instagram size={13} />
              {!sidebarCollapsed && "Instagram"}
            </button>
          </div>
        </div>

        {/* Nav items */}
        <nav className="flex flex-col items-stretch p-2 gap-0.5">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={cn(
                "flex items-center gap-2.5 rounded-lg text-sm px-3 py-2.5 transition-all text-sidebar-foreground",
                activeTab === item.id
                  ? "bg-gradient-to-r from-pink-500/80 to-purple-500/80 text-white shadow-sm"
                  : "hover:bg-white/10",
                sidebarCollapsed && "justify-center px-0"
              )}
            >
              <item.icon size={16} />
              {!sidebarCollapsed && <span>{item.label}</span>}
            </button>
          ))}
        </nav>

        {/* Footer */}
        <div className="mt-auto border-t border-sidebar-border p-2 space-y-0.5">
          {user?.email === "admin@primechat.com" && !sidebarCollapsed && (
            <button onClick={() => navigate("/admin/users")} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors">
              <Users size={16} /> Usuários
            </button>
          )}
          {user?.email === "admin@primechat.com" && sidebarCollapsed && (
            <button onClick={() => navigate("/admin/users")} className="w-full flex justify-center py-2 rounded-lg text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors" title="Usuários">
              <Users size={16} />
            </button>
          )}
          {!sidebarCollapsed && (
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-xs text-sidebar-foreground/50 truncate">{user?.email}</span>
            </div>
          )}
          <div className={cn("flex items-center gap-1", sidebarCollapsed ? "flex-col px-0" : "px-1")}>
            <ThemeToggle collapsed={sidebarCollapsed} />
            <Button variant="ghost" size="icon" onClick={signOut} className="h-8 w-8 text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent" title="Sair">
              <LogOut size={16} />
            </Button>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {activeTab === "chat" && <InstagramChat />}
        {activeTab === "automations" && (
          <div className="flex-1 overflow-auto p-6 max-w-6xl">
            <InstagramAutomations />
          </div>
        )}
        {activeTab === "metrics" && (
          <div className="flex-1 overflow-auto p-6 max-w-6xl">
            <InstagramMetrics />
          </div>
        )}
        {activeTab === "settings" && (
          <div className="flex-1 overflow-auto p-6 max-w-6xl">
            <InstagramSettings />
          </div>
        )}
      </div>
    </div>
  );
}
