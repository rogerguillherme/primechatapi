import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WebhookTab } from "@/components/webhook/WebhookTab";
import { WebhookVariablesTab } from "@/components/webhook/WebhookVariablesTab";
import { WebhookHistoryTab } from "@/components/webhook/WebhookHistoryTab";
import { WebhookActionsTab } from "@/components/webhook/WebhookActionsTab";
import { Link2, Code2, Clock, Zap, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

export default function WebhookSettings() {
  const navigate = useNavigate();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="relative bg-background rounded-2xl shadow-2xl border w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold">Gerenciar Hubla</h2>
          <Button variant="ghost" size="icon" className="rounded-full" onClick={() => navigate(-1)}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Branding */}
        <div className="flex items-center gap-3 px-6 pt-5 pb-2">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Link2 className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="font-semibold text-base">Hubla</p>
            <p className="text-xs text-muted-foreground">Gerenciar Integração Nativa</p>
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="webhook" className="flex flex-col flex-1 min-h-0">
          <div className="px-6">
            <TabsList className="w-full justify-start bg-transparent border-b rounded-none h-auto p-0 gap-0">
              <TabsTrigger
                value="webhook"
                className="gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none px-4 py-2.5 text-sm font-medium text-muted-foreground"
              >
                <Link2 className="h-4 w-4" />
                Webhook
              </TabsTrigger>
              <TabsTrigger
                value="variables"
                className="gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none px-4 py-2.5 text-sm font-medium text-muted-foreground"
              >
                <Code2 className="h-4 w-4" />
                Variáveis
              </TabsTrigger>
              <TabsTrigger
                value="history"
                className="gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none px-4 py-2.5 text-sm font-medium text-muted-foreground"
              >
                <Clock className="h-4 w-4" />
                Histórico
              </TabsTrigger>
              <TabsTrigger
                value="actions"
                className="gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none px-4 py-2.5 text-sm font-medium text-muted-foreground"
              >
                <Code2 className="h-4 w-4" />
                Ações
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            <TabsContent value="webhook" className="mt-0">
              <WebhookTab />
            </TabsContent>
            <TabsContent value="variables" className="mt-0">
              <WebhookVariablesTab />
            </TabsContent>
            <TabsContent value="history" className="mt-0">
              <WebhookHistoryTab />
            </TabsContent>
            <TabsContent value="actions" className="mt-0">
              <WebhookActionsTab />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}
