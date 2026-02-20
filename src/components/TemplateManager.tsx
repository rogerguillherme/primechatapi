import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, FileText, Save } from "lucide-react";

interface Template {
  id: string;
  name: string;
  content: string;
  template_name: string | null;
  template_language: string | null;
  template_params: any;
  category: string | null;
}

const emptyForm = {
  name: "",
  content: "",
  template_name: "",
  template_language: "pt_BR",
  category: "geral",
  template_params: [] as { type: string; text: string }[],
};

export function TemplateManager() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const { data: templates, isLoading } = useQuery({
    queryKey: ["managed-templates"],
    queryFn: async () => {
      const { data } = await supabase.from("chat_templates").select("*").order("name");
      return (data || []) as Template[];
    },
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
      if (editingId) {
        const { error } = await supabase.from("chat_templates").update(payload).eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("chat_templates").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["managed-templates"] });
      queryClient.invalidateQueries({ queryKey: ["chat-templates"] });
      queryClient.invalidateQueries({ queryKey: ["broadcast-templates"] });
      queryClient.invalidateQueries({ queryKey: ["flow-templates"] });
      toast.success(editingId ? "Template atualizado!" : "Template criado!");
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
      queryClient.invalidateQueries({ queryKey: ["managed-templates"] });
      queryClient.invalidateQueries({ queryKey: ["chat-templates"] });
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
    setForm({
      name: t.name,
      content: t.content,
      template_name: t.template_name || "",
      template_language: t.template_language || "pt_BR",
      category: t.category || "geral",
      template_params: params,
    });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingId(null);
    setForm(emptyForm);
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText size={18} />
              Templates de Mensagem
            </CardTitle>
            <CardDescription>Gerencie os templates aprovados pela Meta para uso nos disparos e chat.</CardDescription>
          </div>
          <Button size="sm" onClick={openNew}>
            <Plus size={14} /> Novo Template
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="text-sm text-muted-foreground text-center py-8">Carregando...</p>
          ) : !templates?.length ? (
            <p className="text-sm text-muted-foreground text-center py-8">Nenhum template cadastrado.</p>
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
                      {t.category && (
                        <Badge variant="outline" className="text-[10px]">{t.category}</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{t.content}</p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
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
      </Card>

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
