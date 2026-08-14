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
import { InstagramPosts } from "@/components/instagram/InstagramPosts";
import { InstagramAgent } from "@/components/instagram/InstagramAgent";
import { InstagramComments } from "@/components/instagram/InstagramComments";
import { useProfile } from "@/hooks/use-profile";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  MessageSquare, Zap, BarChart3, Settings, Instagram, MessageCircle,
  ChevronLeft, ChevronRight, LogOut, Users, Plug, CalendarDays, Bot, Menu, X,
} from "lucide-react";

export default function InstagramDashboard() {
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get("tab") || "chat";
  const [activeTab, setActiveTab] = useState(initialTab);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const isMobile = useIsMobile();
  const navCollapsed = sidebarCollapsed && !isMobile;
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { instagramEnabled, loading: profileLoading } = useProfile();

  useEffect(() => {
    if (!profileLoading && user && !instagramEnabled) {
      toast.error("Acesso ao Instagram não liberado para sua conta.");
      navigate("/", { replace: true });
    }
  }, [profileLoading, instagramEnabled, user, navigate]);

  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab && ["chat", "comments", "automations", "metrics", "settings", "posts", "agent"].includes(tab)) {
      setActiveTab(tab);
    }
  }, [searchParams]);

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

  if (profileLoading || !instagramEnabled) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const navItems = [
    { id: "chat", icon: MessageSquare, label: "Chat" },
    { id: "comments", icon: MessageCircle, label: "Comentários" },
    { id: "automations", icon: Zap, label: "Automações" },
    { id: "metrics", icon: BarChart3, label: "Métricas" },
    { id: "posts", icon: CalendarDays, label: "Posts" },
    { id: "agent", icon: Bot, label: "Agente IA" },
    { id: "settings", icon: Settings, label: "Configuração" },
  ];

  return (
    <div className="animate-fade-in flex flex-col md:flex-row h-[100dvh]">
      {/* Barra superior (mobile) */}
      <div className="md:hidden shrink-0 gradient-instagram flex items-center gap-2 px-3 py-2.5 border-b border-sidebar-border">
        <button
          onClick={() => setMobileNavOpen(true)}
          aria-label="Abrir menu"
          className="p-2 -ml-1 rounded-md text-white/80 hover:bg-white/10 transition-colors"
        >
          <Menu size={20} />
        </button>
        <div className="w-7 h-7 rounded-lg bg-pink-500/20 flex items-center justify-center shrink-0">
          <Instagram size={15} className="text-pink-400" />
        </div>
        <h1 className="text-sm font-display font-bold text-white truncate">Insta Prime</h1>
      </div>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 bg-black/60 md:hidden" onClick={() => setMobileNavOpen(false)} aria-hidden />
      )}

      {/* Sidebar */}
      <div className={cn(
        "shrink-0 border-r border-sidebar-border gradient-instagram flex-col transition-all duration-300",
        "fixed inset-y-0 left-0 z-50 w-64 max-w-[85vw] overflow-y-auto",
        "md:relative md:z-auto md:w-56 md:max-w-none",
        mobileNavOpen ? "flex" : "hidden md:flex",
        navCollapsed && "md:w-14"
      )}>
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
            className="hidden md:block p-1.5 rounded-md text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
          >
            {navCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
          <button
            onClick={() => setMobileNavOpen(false)}
            aria-label="Fechar menu"
            className="md:hidden p-1.5 rounded-md text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Platform selector */}
        <div className="px-2 pt-2 pb-1">
          <div className={cn("flex items-center rounded-lg bg-white/10 p-0.5", navCollapsed ? "flex-col gap-0.5" : "")}>
            <button
              onClick={() => navigate("/")}
              className={cn(
                "flex items-center gap-1.5 rounded-md text-xs font-medium transition-all text-white/50 hover:text-white/80",
                navCollapsed ? "p-1.5 w-full justify-center" : "flex-1 px-2.5 py-1.5 justify-center"
              )}
            >
              <MessageCircle size={13} />
              {!navCollapsed && "WhatsApp"}
            </button>
            <button
              className={cn(
                "flex items-center gap-1.5 rounded-md text-xs font-medium transition-all bg-white/20 text-white shadow-sm",
                navCollapsed ? "p-1.5 w-full justify-center" : "flex-1 px-2.5 py-1.5 justify-center"
              )}
            >
              <Instagram size={13} />
              {!navCollapsed && "Instagram"}
            </button>
          </div>
        </div>

        {/* Nav items */}
        <nav className="flex flex-col items-stretch p-2 gap-0.5">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => { setActiveTab(item.id); setMobileNavOpen(false); }}
              className={cn(
                "flex items-center gap-2.5 rounded-lg text-sm px-3 py-2.5 transition-all text-sidebar-foreground",
                activeTab === item.id
                  ? "bg-gradient-to-r from-pink-500/80 to-purple-500/80 text-white shadow-sm"
                  : "hover:bg-white/10",
                navCollapsed && "justify-center px-0"
              )}
            >
              <item.icon size={16} />
              {!navCollapsed && <span>{item.label}</span>}
            </button>
          ))}
        </nav>

        {/* Footer */}
        <div className="mt-auto border-t border-sidebar-border p-2 space-y-0.5">
          {user?.email === "admin@primechat.com" && !navCollapsed && (
            <button onClick={() => navigate("/admin/users")} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors">
              <Users size={16} /> Usuários
            </button>
          )}
          {user?.email === "admin@primechat.com" && navCollapsed && (
            <button onClick={() => navigate("/admin/users")} className="w-full flex justify-center py-2 rounded-lg text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors" title="Usuários">
              <Users size={16} />
            </button>
          )}
          {!navCollapsed && (
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-xs text-sidebar-foreground/50 truncate">{user?.email}</span>
            </div>
          )}
          <div className={cn("flex items-center gap-1", navCollapsed ? "flex-col px-0" : "px-1")}>
            <ThemeToggle collapsed={navCollapsed} />
            <Button variant="ghost" size="icon" onClick={signOut} className="h-8 w-8 text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent" title="Sair">
              <LogOut size={16} />
            </Button>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0 min-w-0">
        {activeTab === "chat" && <InstagramChat />}
        {activeTab === "comments" && (
          <div className="flex-1 overflow-hidden flex flex-col min-h-0">
            <InstagramComments />
          </div>
        )}
        {activeTab === "automations" && (
          <div className="flex-1 overflow-auto p-4 sm:p-6 max-w-6xl">
            <InstagramAutomations />
          </div>
        )}
        {activeTab === "metrics" && (
          <div className="flex-1 overflow-auto">
            <InstagramMetrics />
          </div>
        )}
        {activeTab === "posts" && (
          <div className="flex-1 overflow-auto">
            <InstagramPosts />
          </div>
        )}
        {activeTab === "agent" && (
          <div className="flex-1 overflow-auto">
            <InstagramAgent />
          </div>
        )}
        {activeTab === "settings" && (
          <div className="flex-1 overflow-auto p-4 sm:p-6 max-w-6xl">
            <InstagramSettings />
          </div>
        )}
      </div>
    </div>
  );
}
