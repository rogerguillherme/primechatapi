import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Circle, ListChecks, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Step {
  id: string;
  title: string;
  description: string;
  done: boolean;
  action?: { label: string; href?: string; onClick?: () => void };
}

export function InstagramSetupWizard({ onGoToTab }: { onGoToTab?: (tab: string) => void }) {
  const { user } = useAuth();

  const { data: connections, isLoading: loadingConn } = useQuery({
    queryKey: ["ig-setup-connections", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("instagram_connections" as any)
        .select("id, status, instagram_username, page_id")
        .eq("user_id", user!.id);
      return (data || []) as any[];
    },
    enabled: !!user,
  });

  const { data: automations } = useQuery({
    queryKey: ["ig-setup-automations", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("instagram_automations" as any)
        .select("id, active")
        .eq("user_id", user!.id);
      return (data || []) as any[];
    },
    enabled: !!user,
  });

  const { data: webhookHealth } = useQuery({
    queryKey: ["ig-setup-webhook"],
    queryFn: async () => {
      const { data } = await supabase.functions.invoke("instagram-webhook-stats");
      return data;
    },
    enabled: !!connections?.some((c) => c.status === "connected"),
    refetchInterval: 30000,
  });

  const activeConn = connections?.find((c) => c.status === "connected");
  const subsOk =
    webhookHealth?.subscriptions?.length > 0 &&
    webhookHealth.subscriptions.every((s: any) => s.page_ok && s.ig_ok);
  const eventsReceived = (webhookHealth?.counts?.last_7d ?? 0) > 0;
  const hasActiveAutomation = (automations || []).some((a) => a.active);

  const steps: Step[] = [
    {
      id: "account",
      title: "Conta Instagram Business + Página do Facebook",
      description: "Sua conta IG precisa ser Business/Creator e estar vinculada a uma Página do Facebook administrada por você.",
      done: !!activeConn,
      action: !activeConn
        ? { label: "Configurar requisitos", href: "https://help.instagram.com/502981923235522", }
        : undefined,
    },
    {
      id: "oauth",
      title: "Conectar via OAuth",
      description: "Faça login com o Facebook em primechatapi.lovable.app para autorizar o acesso. Previews falham — use o domínio publicado.",
      done: !!activeConn,
      action: !activeConn
        ? { label: "Ir para Configuração", onClick: () => onGoToTab?.("settings") }
        : undefined,
    },
    {
      id: "subscriptions",
      title: "Webhooks assinados na Meta",
      description: "Os campos messages, messaging_postbacks (Página) e comments, messages (Instagram) precisam estar inscritos.",
      done: !!subsOk,
      action: activeConn && !subsOk
        ? { label: "Ativar webhooks", onClick: () => onGoToTab?.("settings") }
        : undefined,
    },
    {
      id: "events",
      title: "Recebendo eventos da Meta",
      description: "Pelo menos um evento (DM ou comentário) precisa ter sido entregue nos últimos 7 dias.",
      done: !!eventsReceived,
    },
    {
      id: "automation",
      title: "Pelo menos uma automação ativa",
      description: "Crie uma automação por palavra-chave ou DM para começar a responder automaticamente.",
      done: !!hasActiveAutomation,
      action: !hasActiveAutomation
        ? { label: "Criar automação", onClick: () => onGoToTab?.("automations") }
        : undefined,
    },
  ];

  const completed = steps.filter((s) => s.done).length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-purple-500" />
            <CardTitle className="text-base">Assistente de configuração</CardTitle>
          </div>
          <span className="text-sm text-muted-foreground">
            {completed}/{steps.length} concluídos
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loadingConn && <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}

        {/* progress bar */}
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all"
            style={{ width: `${(completed / steps.length) * 100}%` }}
          />
        </div>

        {steps.map((s, i) => (
          <div
            key={s.id}
            className={`rounded-lg border p-3 flex items-start gap-3 ${
              s.done ? "bg-green-500/5 border-green-500/20" : "bg-card"
            }`}
          >
            <div className="mt-0.5">
              {s.done ? (
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              ) : (
                <Circle className="h-5 w-5 text-muted-foreground" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">
                {i + 1}. {s.title}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{s.description}</p>
            </div>
            {s.action && !s.done && (
              <Button
                size="sm"
                variant="outline"
                onClick={s.action.onClick}
                asChild={!!s.action.href}
              >
                {s.action.href ? (
                  <a href={s.action.href} target="_blank" rel="noreferrer">
                    {s.action.label} <ExternalLink className="h-3 w-3 ml-1" />
                  </a>
                ) : (
                  <span>{s.action.label}</span>
                )}
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
