import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AppHeader } from "@/components/AppHeader";
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

function AppRoutes() {
  return (
    <Routes>
      <Route path="/auth" element={<Auth />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <div className="min-h-screen flex flex-col">
              <AppHeader />
              <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 max-w-7xl mx-auto w-full">
                <WhatsAppApi />
              </main>
              <HelpChatBubble />
            </div>
          </ProtectedRoute>
        }
      />
      <Route
        path="/auth/meta/callback"
        element={
          <ProtectedRoute>
            <div className="min-h-screen flex flex-col">
              <AppHeader />
              <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 max-w-7xl mx-auto w-full">
                <MetaConnect />
              </main>
            </div>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/users"
        element={
          <ProtectedRoute>
            <div className="min-h-screen flex flex-col">
              <AppHeader />
              <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 max-w-7xl mx-auto w-full">
                <AdminUsers />
              </main>
            </div>
          </ProtectedRoute>
        }
      />
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
