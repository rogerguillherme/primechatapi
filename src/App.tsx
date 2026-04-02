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

const queryClient = new QueryClient();

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
  return (
    <ProtectedRoute>
      <div className="min-h-screen flex">
        <AppSidebar />
        <main className="flex-1 ml-[68px] lg:ml-64 transition-all duration-300">
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

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
