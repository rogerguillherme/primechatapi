import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WebhookTab } from "@/components/webhook/WebhookTab";
import { WebhookVariablesTab } from "@/components/webhook/WebhookVariablesTab";
import { WebhookHistoryTab } from "@/components/webhook/WebhookHistoryTab";
import { WebhookActionsTab } from "@/components/webhook/WebhookActionsTab";
import { Link2, Code2, Clock, Zap } from "lucide-react";

export default function WebhookSettings() {
  return (
    <div>
      <PageHeader title="Configurações de Webhook" description="Configure a integração com a Hubla para receber pedidos automaticamente." />

      <div className="max-w-3xl">
        <Tabs defaultValue="webhook" className="w-full">
          <TabsList className="w-full justify-start mb-6 bg-muted/50 p-1">
            <TabsTrigger value="webhook" className="gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <Link2 className="h-4 w-4" />
              Webhook
            </TabsTrigger>
            <TabsTrigger value="variables" className="gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <Code2 className="h-4 w-4" />
              Variáveis
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <Clock className="h-4 w-4" />
              Histórico
            </TabsTrigger>
            <TabsTrigger value="actions" className="gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <Zap className="h-4 w-4" />
              Ações
            </TabsTrigger>
          </TabsList>

          <TabsContent value="webhook">
            <WebhookTab />
          </TabsContent>
          <TabsContent value="variables">
            <WebhookVariablesTab />
          </TabsContent>
          <TabsContent value="history">
            <WebhookHistoryTab />
          </TabsContent>
          <TabsContent value="actions">
            <WebhookActionsTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
