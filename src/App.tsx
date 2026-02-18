import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppSidebar } from "@/components/AppSidebar";
import Dashboard from "./pages/Dashboard";
import Leads from "./pages/Leads";
import Orders from "./pages/Orders";
import Refunds from "./pages/Refunds";
import Products from "./pages/Products";
import Items from "./pages/Items";
import WebhookSettings from "./pages/WebhookSettings";
import Expirations from "./pages/Expirations";
import Chat from "./pages/Chat";
import WhatsAppApi from "./pages/WhatsAppApi";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <div className="flex min-h-screen">
          <AppSidebar />
          <main className="flex-1 p-6 lg:p-8 overflow-auto">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/leads" element={<Leads />} />
              <Route path="/orders" element={<Orders />} />
              <Route path="/refunds" element={<Refunds />} />
              <Route path="/products" element={<Products />} />
              <Route path="/items" element={<Items />} />
              <Route path="/expirations" element={<Expirations />} />
              <Route path="/chat" element={<Chat />} />
              <Route path="/whatsapp-api" element={<WhatsAppApi />} />
              <Route path="/webhook" element={<WebhookSettings />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
