import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AppHeader } from "@/components/AppHeader";
import { MetrikHeader } from "@/components/MetrikHeader";
import { AiAssistantChat } from "@/components/AiAssistantChat";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { PlatformProvider } from "@/contexts/PlatformContext";
// Cada tela vira um arquivo separado, baixado só quando alguém entra nela.
// Antes o build era um único JS de 2,6 MB: quem abria o login esperava o
// construtor de fluxos, os gráficos e o leitor de planilha carregarem junto.
import { lazy, Suspense } from "react";
const WhatsAppApi = lazy(() => import("./pages/WhatsAppApi"));
const MetaConnect = lazy(() => import("./pages/MetaConnect"));
const InstagramDashboard = lazy(() => import("./pages/InstagramDashboard"));
const InstagramCallbackPage = lazy(() => import("./pages/InstagramCallback"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Auth = lazy(() => import("./pages/Auth"));
const TrialSignup = lazy(() => import("./pages/TrialSignup"));
const TrialExpired = lazy(() => import("./pages/TrialExpired"));
const LandingPage = lazy(() => import("./pages/LandingPage"));
const AdminUsers = lazy(() => import("./pages/AdminUsers"));
const WabaHealth = lazy(() => import("./pages/WabaHealth"));
const Metrik = lazy(() => import("./pages/Metrik"));
import { Loader2 } from "lucide-react";
import { BroadcastProgressFloat } from "@/components/BroadcastProgressFloat";
import { useTrialStatus } from "@/hooks/use-trial-status";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  const { isExpired, loading: trialLoading } = useTrialStatus();
  const location = useLocation();

  if (loading || (session && trialLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!session) {
    const redirectTo = `${location.pathname}${location.search}${location.hash}`;
    // Cada produto tem a sua porta. Mandar quem tentou abrir o painel
    // comercial para a tela do chat faz parecer que ele errou de sistema.
    const porta = location.pathname.startsWith("/metrik") ? "/metrik/entrar" : "/auth";
    return <Navigate to={`${porta}?redirect=${encodeURIComponent(redirectTo)}`} replace />;
  }

  if (isExpired) {
    return <Navigate to="/trial-expirado" replace />;
  }

  return <>{children}</>;
}

function AdminOnlyRoute({ children }: { children: React.ReactNode }) {
  const { session, user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!session) {
    const redirectTo = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={`/auth?redirect=${encodeURIComponent(redirectTo)}`} replace />;
  }

  if (user?.email !== "admin@primechat.com") {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}


/** Mesma marca d'água do ProtectedRoute, para a troca de tela não piscar. */
function RouteFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

function AppRoutes() {
  return (
    <Suspense fallback={<RouteFallback />}>
    <Routes>
      <Route path="/auth" element={<Auth />} />
      {/* Porta própria do Metrik: mesma tela, outra identidade e outro destino. */}
      <Route path="/metrik/entrar" element={<Auth produto="metrics" />} />
      <Route path="/teste-gratis" element={<TrialSignup />} />
      <Route path="/trial-expirado" element={<TrialExpired />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <WhatsAppApi />
            <AiAssistantChat />
          </ProtectedRoute>
        }
      />
      <Route
        path="/instagram"
        element={
          <ProtectedRoute>
            <InstagramDashboard />
            <AiAssistantChat />
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
        path="/auth/instagram/callback"
        element={
          <ProtectedRoute>
            <InstagramCallbackPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/users"
        element={
          <AdminOnlyRoute>
            <div className="min-h-screen flex flex-col">
              <AppHeader />
              <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 max-w-7xl mx-auto w-full">
                <AdminUsers />
              </main>
            </div>
          </AdminOnlyRoute>
        }
      />
      <Route
        path="/metrik"
        element={
          <ProtectedRoute>
            <div className="min-h-screen flex flex-col">
              <MetrikHeader />
              <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 max-w-7xl mx-auto w-full">
                <Metrik />
              </main>
            </div>
          </ProtectedRoute>
        }
      />
      <Route
        path="/whatsapp/health"
        element={
          <ProtectedRoute>
            <div className="min-h-screen flex flex-col">
              <AppHeader />
              <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 max-w-7xl mx-auto w-full">
                <WabaHealth />
              </main>
            </div>
          </ProtectedRoute>
        }
      />
      <Route path="/site" element={<LandingPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
    </Suspense>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <PlatformProvider>
            <AppRoutes />
            <BroadcastProgressFloat />
          </PlatformProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
