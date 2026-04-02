import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AppSidebar } from "@/components/AppSidebar";
import { HelpChatBubble } from "@/components/HelpChatBubble";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import WhatsAppApi from "./pages/WhatsAppApi";
import MetaConnect from "./pages/MetaConnect";
import NotFound from "./pages/NotFound";
import Auth from "./pages/Auth";
import AdminUsers from "./pages/AdminUsers";
import { Loader2 } from "lucide-react";
import { createContext, useContext, useState } from "react";

const queryClient = new QueryClient();

const SidebarContext = createContext({ collapsed: false, setCollapsed: (_: boolean) => {} });
export const useSidebarState = () => useContext(SidebarContext);

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/auth" replace />;
  }

  return <>{children}</>;
}

function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebarState();
  return (
    <ProtectedRoute>
      <div className="min-h-screen flex">
        <AppSidebar />
        <main
          className="flex-1 transition-all duration-300"
          style={{ marginLeft: collapsed ? 68 : 256 }}
        >
          <div className="p-6 max-w-7xl mx-auto w-full">
            {children}
          </div>
        </main>
        <HelpChatBubble />
      </div>
    </ProtectedRoute>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/auth" element={<Auth />} />
      <Route path="/" element={<ProtectedLayout><WhatsAppApi /></ProtectedLayout>} />
      <Route path="/auth/meta/callback" element={<ProtectedLayout><MetaConnect /></ProtectedLayout>} />
      <Route path="/admin/users" element={<ProtectedLayout><AdminUsers /></ProtectedLayout>} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

const App = () => {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <SidebarContext.Provider value={{ collapsed, setCollapsed }}>
              <AppRoutes />
            </SidebarContext.Provider>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
