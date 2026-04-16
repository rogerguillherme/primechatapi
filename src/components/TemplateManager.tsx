import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, FileText, Save, RefreshCw, ChevronDown, Send, CheckCircle2, Clock, XCircle } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useWhatsAppAccounts } from "@/hooks/use-whatsapp-accounts";
import { useUserTemplates } from "@/hooks/use-user-templates";

interface Template {
  id: string;
  name: string;
  content: string;
  template_name: string | null;
  template_language: string | null;
  template_params: any;
  category: string | null;
  meta_status?: string | null;
}

const emptyForm = {
  name: "",
  content: "",
  template_name: "",
  template_language: "pt_BR",
  category: "geral",
  template_params: [] as { type: string; text: string }[],
  accountIds: [] as string[],
};

const metaStatusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  APPROVED: { label: "Aprovado", variant: "default" },
  PENDING: { label: "Pendente", variant: "secondary" },
  REJECTED: { label: "Rejeitado", variant: "destructive" },
  PAUSED: { label: "Pausado", variant: "outline" },
  DISABLED: { label: "Desativado", variant: "outline" },
  unknown: { label: "Não sincronizado", variant: "outline" },
};

export function TemplateManager() {
  const queryClient = useQueryClient();
  const { accounts } = useWhatsAppAccounts();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [isOpen, setIsOpen] = useState(true);

  const { templates: rawTemplates, isLoading } = useUserTemplates();
  const templates = rawTemplates as Template[];

  const { data: accountTemplates } = useQuery({
    queryKey: ["account-templates"],
    queryFn: async () => {
      const { data } = await supabase.from("account_templates").select("*");
      return (data || []) as { id: string; account_id: string; template_id: string }[];
    },
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["user-templates"] });
    queryClient.invalidateQueries({ queryKey: ["managed-templates"] });
    queryClient.invalidateQueries({ queryKey: ["account-templates"] });
    queryClient.invalidateQueries({ queryKey: ["chat-templates"] });
    queryClient.invalidateQueries({ queryKey: ["broadcast-templates"] });
    queryClient.invalidateQueries({ queryKey: ["flow-templates"] });
  };

  const syncMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("whatsapp-sync-templates", {
        body: {},
      });
      if (error) throw new Error(error.message || "Erro ao sincronizar");
      return data;
    },
    onSuccess: async (data: any) => {
      // Force immediate refetch instead of just invalidating
      await queryClient.refetchQueries({ queryKey: ["user-templates"] });
      await queryClient.refetchQueries({ queryKey: ["account-templates"] });
      invalidateAll();
      const results = data?.results || [];
      const totalSynced = results.reduce((sum: number, r: any) => sum + (r.synced || 0), 0);
      const errors = results.filter((r: any) => r.error);
      if (errors.length > 0) {
        toast.warning(`Sincronizado ${totalSynced} templates. ${errors.length} conta(s) com erro.`);
      } else {
        toast.success(`${totalSynced} templates sincronizados em tempo real!`);
      }
    },
    onError: (err: any) => toast.error(`Erro ao sincronizar: ${err.message}`),
  });

  const submitToMetaMutation = useMutation({
    mutationFn: async (template: Template) => {
      const linkedAccountIds = (accountTemplates || [])
        .filter((at) => at.template_id === template.id)
        .map((at) => at.account_id);
      const accountId = linkedAccountIds[0] || accounts[0]?.id;
      if (!accountId) throw new Error("Vincule uma conta WhatsApp ao template antes de enviar.");

      const { data, error } = await supabase.functions.invoke("whatsapp-create-template", {
        body: {
          template_id: template.id,
          account_id: accountId,
          name: template.template_name || template.name,
          language: template.template_language || "pt_BR",
          category: (template.category || "marketing").toUpperCase(),
          content: template.content,
        },
      });
      if (error) throw new Error(error.message || "Erro ao enviar para Meta");
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: async (data: any) => {
      await queryClient.refetchQueries({ queryKey: ["user-templates"] });
      toast.success(`Template enviado para Meta! Status: ${data.status}`);
      // Auto-sync after 3s to fetch latest status
      setTimeout(() => syncMutation.mutate(), 3000);
    },
    onError: (err: any) => toast.error(`Erro Meta: ${err.message}`),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form.name.trim() || !form.content.trim()) throw new Error("Nome e conteúdo são obrigatórios.");
      const payload = {
        name: form.name.trim(),
        content: form.content.trim(),
        template_name: form.template_name.trim() || null,
        template_language: form.template_language.trim() || "pt_BR",
        category: form.category.trim() || "geral",
        template_params: form.template_params.length > 0 ? form.template_params : [],
      };
      let templateId = editingId;
      if (editingId) {
        const { error } = await supabase.from("chat_templates").update(payload).eq("id", editingId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("chat_templates").insert(payload).select("id").single();
        if (error) throw error;
        templateId = data.id;
      }
      if (templateId) {
        await supabase.from("account_templates").delete().eq("template_id", templateId);
        if (form.accountIds.length > 0) {
          const rows = form.accountIds.map((aid) => ({ account_id: aid, template_id: templateId! }));
          const { error: linkErr } = await supabase.from("account_templates").insert(rows);
          if (linkErr) throw linkErr;
        }
      }
    },
    onSuccess: () => {
      invalidateAll();
      toast.success(editingId ? "Template atualizado!" : "Template criado localmente! Clique em 'Enviar p/ Meta' para aprovação.");
      closeDialog();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("chat_templates").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateAll();
      toast.success("Template removido.");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const openNew = () => {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (t: Template) => {
    setEditingId(t.id);
    const params = Array.isArray(t.template_params)
      ? (t.template_params as any[]).map((p: any) =>
          typeof p === "string" ? { type: "text", text: p } : { type: p?.type || "text", text: p?.text || "" }
        )
      : [];
    const linkedAccountIds = (accountTemplates || [])
      .filter((at) => at.template_id === t.id)
      .map((at) => at.account_id);
    setForm({
      name: t.name,
      content: t.content,
      template_name: t.template_name || "",
      template_language: t.template_language || "pt_BR",
      category: t.category || "geral",
      template_params: params,
      accountIds: linkedAccountIds,
    });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingId(null);
    setForm(emptyForm);
  };

  const getStatusBadge = (status: string | null | undefined) => {
    const s = status || "unknown";
    const config = metaStatusConfig[s] || metaStatusConfig.unknown;
    const Icon = s === "APPROVED" ? CheckCircle2 : s === "PENDING" ? Clock : s === "REJECTED" ? XCircle : null;
    return (
      <Badge variant={config.variant} className="text-[10px] gap-1">
        {Icon && <Icon size={10} />}
        {config.label}
      </Badge>
    );
  };

  const canSubmitToMeta = (t: Template) => {
    const status = t.meta_status || "unknown";
    return status === "unknown" || status === "REJECTED";
  };

  return (
    <>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div className="flex items-center gap-2">
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <ChevronDown size={16} className={`transition-transform ${isOpen ? "" : "-rotate-90"}`} />
                </Button>
              </CollapsibleTrigger>
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText size={18} />
                  Templates de Mensagem
                </CardTitle>
                <CardDescription>Gerencie os templates aprovados pela Meta para uso nos disparos e chat.</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
              >
                <RefreshCw size={14} className={syncMutation.isPending ? "animate-spin" : ""} />
                {syncMutation.isPending ? "Sincronizando..." : "Sincronizar Meta"}
              </Button>
              <Button size="sm" onClick={openNew}>
                <Plus size={14} /> Novo Template
              </Button>
            </div>
          </CardHeader>
          <CollapsibleContent>
            <CardContent className="p-0">
              {isLoading ? (
                <p className="text-sm text-muted-foreground text-center py-8">Carregando...</p>
              ) : !templates?.length ? (
                <p className="text-sm text-muted-foreground text-center py-8">Nenhum template cadastrado. Clique em "Sincronizar Meta" para importar.</p>
              ) : (
                <div className="divide-y divide-border">
                  {templates.map((t) => (
                    <div key={t.id} className="flex items-start gap-3 px-4 py-3 hover:bg-accent/30 transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium">{t.name}</p>
                          {t.template_name && (
                            <Badge variant="secondary" className="text-[10px]">API: {t.template_name}</Badge>
                          )}
                          {getStatusBadge(t.meta_status)}
                          {t.category && (
                            <Badge variant="outline" className="text-[10px]">{t.category}</Badge>
                          )}
                          {(accountTemplates || [])
                            .filter((at) => at.template_id === t.id)
                            .map((at) => {
                              const acc = accounts.find((a) => a.id === at.account_id);
                              return acc ? (
                                <Badge key={at.id} variant="default" className="text-[10px]">{acc.name}</Badge>
                              ) : null;
                            })}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{t.content}</p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {canSubmitToMeta(t) && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1"
                            onClick={() => submitToMetaMutation.mutate(t)}
                            disabled={submitToMetaMutation.isPending}
                            title="Enviar para aprovação da Meta"
                          >
                            <Send size={12} />
                            <span className="text-xs">Enviar p/ Meta</span>
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(t)}>
                          <Pencil size={13} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => { if (confirm(`Remover template "${t.name}"?`)) deleteMutation.mutate(t.id); }}
                        >
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar Template" : "Novo Template"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Nome de exibição *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ex: Boas-vindas"
              />
            </div>
            <div className="space-y-2">
              <Label>Conteúdo / Preview *</Label>
              <textarea
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                placeholder="Olá! Seja bem-vindo..."
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px] resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                rows={3}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Nome na Meta (template_name)</Label>
                <Input
                  value={form.template_name}
                  onChange={(e) => setForm({ ...form, template_name: e.target.value })}
                  placeholder="Ex: hello_world"
                  className="font-mono text-sm"
                />
                <p className="text-[11px] text-muted-foreground">
                  Deve ser idêntico ao nome aprovado no Facebook Business Manager.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Idioma</Label>
                <Input
                  value={form.template_language}
                  onChange={(e) => setForm({ ...form, template_language: e.target.value })}
                  placeholder="pt_BR"
                  className="font-mono text-sm"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Categoria</Label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="geral">Geral</option>
                <option value="marketing">Marketing</option>
                <option value="utility">Utilidade</option>
                <option value="authentication">Autenticação</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Parâmetros do Template</Label>
              <p className="text-[11px] text-muted-foreground">
                Adicione os parâmetros que o template espera (ex: {"{{1}}"}, {"{{2}}"}). Use {"{nome}"} para substituir pelo nome do lead.
              </p>
              {form.template_params.map((param, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-8">{`{{${i + 1}}}`}</span>
                  <Input
                    value={param.text}
                    onChange={(e) => {
                      const newParams = [...form.template_params];
                      newParams[i] = { type: "text", text: e.target.value };
                      setForm({ ...form, template_params: newParams });
                    }}
                    placeholder={`Valor para {{${i + 1}}} (ex: {nome})`}
                    className="text-sm"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive flex-shrink-0"
                    onClick={() => {
                      const newParams = form.template_params.filter((_, idx) => idx !== i);
                      setForm({ ...form, template_params: newParams });
                    }}
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setForm({ ...form, template_params: [...form.template_params, { type: "text", text: "" }] })}
              >
                <Plus size={14} /> Adicionar Parâmetro
              </Button>
            </div>
            {accounts.length > 0 && (
              <div className="space-y-2">
                <Label>Contas WhatsApp associadas</Label>
                <p className="text-[11px] text-muted-foreground">
                  Selecione quais contas podem usar este template nos disparos.
                </p>
                <div className="space-y-1.5">
                  {accounts.map((acc) => (
                    <label key={acc.id} className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={form.accountIds.includes(acc.id)}
                        onCheckedChange={(checked) => {
                          setForm({
                            ...form,
                            accountIds: checked
                              ? [...form.accountIds, acc.id]
                              : form.accountIds.filter((id) => id !== acc.id),
                          });
                        }}
                      />
                      <span className="text-sm">{acc.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancelar</Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              <Save size={14} />
              {saveMutation.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
