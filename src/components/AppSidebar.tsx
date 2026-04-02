import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard, Users, ShoppingCart, Package, Box, Webhook,
  ChevronLeft, ChevronRight, CalendarClock, MessageSquare,
  RotateCcw, MessageCircle, LogOut, Plug, Shield,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { useSidebarState } from "@/App";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/leads", icon: Users, label: "Leads" },
  { to: "/orders", icon: ShoppingCart, label: "Pedidos" },
  { to: "/refunds", icon: RotateCcw, label: "Reembolsos" },
  { to: "/products", icon: Package, label: "Produtos" },
  { to: "/items", icon: Box, label: "Itens Físicos" },
  { to: "/expirations", icon: CalendarClock, label: "Vencimentos" },
  { to: "/chat", icon: MessageSquare, label: "Chat" },
  { to: "/whatsapp-api", icon: MessageCircle, label: "WhatsApp API" },
  { to: "/webhook", icon: Webhook, label: "Webhook" },
];

export function AppSidebar() {
  const { collapsed, setCollapsed } = useSidebarState();
  const location = useLocation();
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
    <aside
      className={cn(
        "fixed top-0 left-0 z-40 h-screen flex flex-col border-r border-sidebar-border transition-all duration-300",
        "bg-sidebar/80 backdrop-blur-xl",
        collapsed ? "w-[68px]" : "w-64"
      )}
    >
      {/* Logo */}
      <div className="flex items-center justify-between p-4 border-b border-sidebar-border/50">
        {!collapsed && (
          <div className="animate-fade-in flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-whatsapp/20 flex items-center justify-center">
              <MessageCircle size={16} className="text-whatsapp" />
            </div>
            <div>
              <h1 className="text-sm font-display font-bold text-sidebar-primary">Prime Chat</h1>
              <p className="text-[10px] text-sidebar-foreground/40 leading-none">Plataforma de Comunicação</p>
            </div>
          </div>
        )}
        {collapsed && (
          <div className="w-8 h-8 rounded-lg bg-whatsapp/20 flex items-center justify-center mx-auto">
            <MessageCircle size={16} className="text-whatsapp" />
          </div>
        )}
      </div>

      {/* Toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className={cn(
          "absolute -right-3 top-20 z-50 w-6 h-6 rounded-full border border-sidebar-border",
          "bg-sidebar flex items-center justify-center",
          "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors",
          "shadow-md"
        )}
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
      </button>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        <p className={cn(
          "text-[10px] uppercase tracking-widest text-sidebar-foreground/30 font-semibold mb-2",
          collapsed ? "text-center" : "px-3"
        )}>
          {collapsed ? "•" : "Menu"}
        </p>
        {navItems.map((item) => {
          const isActive = location.pathname === item.to;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 group relative",
                collapsed && "justify-center px-2",
                isActive
                  ? "bg-sidebar-primary/15 text-sidebar-primary shadow-sm border border-sidebar-primary/20"
                  : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/60"
              )}
            >
              <item.icon size={18} className={cn(
                "shrink-0 transition-colors",
                isActive ? "text-sidebar-primary" : "group-hover:text-sidebar-foreground"
              )} />
              {!collapsed && <span className="animate-fade-in truncate">{item.label}</span>}
              {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-sidebar-primary" />
              )}
              {/* Tooltip for collapsed */}
              {collapsed && (
                <div className="absolute left-full ml-2 px-2 py-1 rounded-md bg-popover text-popover-foreground text-xs font-medium opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all whitespace-nowrap shadow-lg border border-border z-50">
                  {item.label}
                </div>
              )}
            </NavLink>
          );
        })}

        {/* Admin section */}
        {isAdmin && (
          <>
            <p className={cn(
              "text-[10px] uppercase tracking-widest text-sidebar-foreground/30 font-semibold mt-4 mb-2",
              collapsed ? "text-center" : "px-3"
            )}>
              {collapsed ? "•" : "Admin"}
            </p>
            <button
              onClick={() => navigate("/auth/meta/callback")}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 w-full",
                collapsed && "justify-center px-2",
                "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/60"
              )}
            >
              <Plug size={18} className="shrink-0" />
              {!collapsed && <span className="animate-fade-in">Conexão Meta</span>}
            </button>
            <button
              onClick={() => navigate("/admin/users")}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 w-full",
                collapsed && "justify-center px-2",
                "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/60"
              )}
            >
              <Shield size={18} className="shrink-0" />
              {!collapsed && <span className="animate-fade-in">Usuários</span>}
            </button>
          </>
        )}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-sidebar-border/50 space-y-1">
        <ThemeToggle collapsed={collapsed} />
        {user && (
          <button
            onClick={signOut}
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium w-full transition-all duration-200",
              collapsed && "justify-center px-2",
              "text-sidebar-foreground/40 hover:text-destructive hover:bg-destructive/10"
            )}
          >
            <LogOut size={18} className="shrink-0" />
            {!collapsed && <span className="animate-fade-in">Sair</span>}
          </button>
        )}
        {!collapsed && user && (
          <div className="px-3 py-2">
            <p className="text-[10px] text-sidebar-foreground/30 truncate">{user.email}</p>
          </div>
        )}
      </div>
    </aside>
  );
}
