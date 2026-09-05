import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWhatsAppAccounts } from "@/hooks/use-whatsapp-accounts";
import { useUserTemplates } from "@/hooks/use-user-templates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { FileText, ChevronDown, LinkIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const metaStatusColors: Record<string, string> = {
  APPROVED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
  PENDING: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  REJECTED: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  PAUSED: "bg-muted text-muted-foreground",
  DISABLED: "bg-muted text-muted-foreground",
  unknown: "bg-muted text-muted-foreground",
};

const metaStatusLabels: Record<string, string> = {
  APPROVED: "Aprovado",
  PENDING: "Pendente",
  REJECTED: "Rejeitado",
  PAUSED: "Pausado",
  DISABLED: "Desativado",
  unknown: "—",
};

export function TemplateAccountBar() {
  const [isOpen, setIsOpen] = useState(false);
  const { accounts } = useWhatsAppAccounts();
  const { templates, isLoading } = useUserTemplates();

  const { data: accountTemplates } = useQuery({
    queryKey: ["account-templates"],
    queryFn: async () => {
      const { data } = await supabase.from("account_templates").select("*");
      return (data || []) as { id: string; account_id: string; template_id: string }[];
    },
  });

  const getLinkedAccounts = (templateId: string) => {
    const linked = (accountTemplates || []).filter((at) => at.template_id === templateId);
    if (linked.length === 0) return [{ id: "global", name: "Todas as contas" }];
    return linked
      .map((at) => accounts.find((a) => a.id === at.account_id))
      .filter(Boolean) as { id: string; name: string }[];
  };

  const approvedCount = (templates || []).filter((t: any) => t.meta_status === "APPROVED").length;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between py-3 px-4">
          <div className="flex items-center gap-2">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <ChevronDown size={16} className={cn("transition-transform", isOpen ? "" : "-rotate-90")} />
              </Button>
            </CollapsibleTrigger>
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText size={16} />
              Templates & Contas
            </CardTitle>
          </div>
          <div className="flex gap-1.5">
            <Badge variant="secondary" className="text-[10px]">{templates?.length || 0} total</Badge>
            <Badge className="text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 border-0">
              {approvedCount} aprovados
            </Badge>
          </div>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="p-0">
            {isLoading ? (
              <p className="text-sm text-muted-foreground text-center py-8">Carregando...</p>
            ) : !templates?.length ? (
              <p className="text-sm text-muted-foreground text-center py-8">Nenhum template cadastrado.</p>
            ) : (
              <ScrollArea className="max-h-[380px]">
                <div className="divide-y divide-border">
                  {(templates as any[]).map((t) => {
                    const linked = getLinkedAccounts(t.id);
                    const status = t.meta_status || "unknown";
                    return (
                      <div key={t.id} className="px-4 py-3 hover:bg-accent/30 transition-colors">
                        <div className="flex items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-medium truncate">{t.name}</p>
                              <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium", metaStatusColors[status])}>
                                {metaStatusLabels[status]}
                              </span>
                            </div>

                            {t.template_name && (
                              <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                                API: {t.template_name} · {t.template_language || "pt_BR"}
                              </p>
                            )}

                            <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{t.content}</p>

                            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                              <LinkIcon size={10} className="text-muted-foreground shrink-0" />
                              {linked.map((acc) => (
                                <Badge
                                  key={acc.id}
                                  variant={acc.id === "global" ? "outline" : "secondary"}
                                  className="text-[10px] py-0 h-5"
                                >
                                  {acc.name}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
