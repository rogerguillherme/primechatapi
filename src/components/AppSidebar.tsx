import { NavLink, useLocation } from "react-router-dom";
import { LayoutDashboard, Users, ShoppingCart, Package, Box, Webhook, ChevronLeft, ChevronRight, CalendarClock, MessageSquare, RotateCcw, MessageCircle } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ThemeToggle";

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
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();

  return (
    <aside
      className={cn(
        "bg-sidebar flex flex-col border-r border-sidebar-border transition-all duration-300 min-h-screen",
        collapsed ? "w-16" : "w-64"
      )}
    >
      <div className="flex items-center justify-between p-4 border-b border-sidebar-border">
        {!collapsed && (
          <div className="animate-fade-in">
            <h1 className="text-lg font-display font-bold text-sidebar-primary">PC</h1>
            <p className="text-xs text-sidebar-foreground/60">Prime Chat</p>
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 rounded-md text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      <nav className="flex-1 p-2 space-y-1">
        {navItems.map((item) => {
          const isActive = location.pathname === item.to;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                isActive
                  ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-md"
                  : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
              )}
            >
              <item.icon size={18} />
              {!collapsed && <span className="animate-fade-in">{item.label}</span>}
            </NavLink>
          );
        })}
      </nav>

      <div className="p-2 border-t border-sidebar-border space-y-1">
        <ThemeToggle collapsed={collapsed} />
        {!collapsed && (
          <p className="text-[10px] text-sidebar-foreground/40 px-3 py-1">Prime Chat v1.0</p>
        )}
      </div>
    </aside>
  );
}
