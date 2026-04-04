import { useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InstagramChat } from "@/components/instagram/InstagramChat";
import { InstagramAutomations } from "@/components/instagram/InstagramAutomations";
import { InstagramMetrics } from "@/components/instagram/InstagramMetrics";
import { InstagramSettings } from "@/components/instagram/InstagramSettings";
import { MessageSquare, Zap, BarChart3, Settings } from "lucide-react";

export default function InstagramDashboard() {
  const [activeTab, setActiveTab] = useState("chat");

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader />
      <div className="flex-1 flex flex-col">
        <div className="border-b bg-card/50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="h-12 bg-transparent gap-2">
                <TabsTrigger value="chat" className="gap-2 data-[state=active]:bg-primary/10">
                  <MessageSquare size={16} /> Chat
                </TabsTrigger>
                <TabsTrigger value="automations" className="gap-2 data-[state=active]:bg-primary/10">
                  <Zap size={16} /> Automações
                </TabsTrigger>
                <TabsTrigger value="metrics" className="gap-2 data-[state=active]:bg-primary/10">
                  <BarChart3 size={16} /> Métricas
                </TabsTrigger>
                <TabsTrigger value="settings" className="gap-2 data-[state=active]:bg-primary/10">
                  <Settings size={16} /> Configuração
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>

        <div className="flex-1">
          {activeTab === "chat" && <InstagramChat />}
          {activeTab === "automations" && <InstagramAutomations />}
          {activeTab === "metrics" && <InstagramMetrics />}
          {activeTab === "settings" && <InstagramSettings />}
        </div>
      </div>
    </div>
  );
}
