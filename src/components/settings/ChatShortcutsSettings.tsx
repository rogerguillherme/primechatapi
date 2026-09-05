import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTeamContext } from "@/hooks/use-team";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Pencil, Plus, Trash2, Zap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type ActionType = "message" | "flow";

export interface ChatShortcut {
  id: string;
  command: string;
  description: string | null;
  action_type: ActionType;
  message: string | null;
  flow_id: string | null;
  active: boolean;
}

const EMPTY_FORM = {
  command: "",
  description: "",
  action_type: "message" as ActionType,
  message: "",
  flow_id: "",
};

/** Normaliza o comando: sem barra inicial, sem espaços, minúsculo. */
function normalizeCommand(raw: string): string {
  return raw
    .trim()
    .replace(/^\/+/, "")
    .replace(/\s+/g, "-")
    .toLowerCase();
}

export function ChatShortcutsSettings() {
  const { user } = useAuth();
  const { data: team } = useTeamContext();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  // Mesmo painel serve para criar e editar; `editingId` diz qual dos dois.
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data: flows } = useQuery({
    queryKey: ["flows-shortcuts", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("flows")
        .select("id, name")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: shortcuts, isLoading } = useQuery({
    queryKey: ["chat-shortcuts", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chat_shortcuts")
        .select("id, command, description, action_type, message, flow_id, active")
        .order("command");
      if (error) throw error;
      return (data || []) as unknown as ChatShortcut[];
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["chat-shortcuts", user?.id] });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Sessão expirada");
      const command = normalizeCommand(form.command);
      if (!command) throw new Error("Informe o comando do atalho (ex.: fluxo1)");
      if (form.action_type === "message" && !form.message.trim()) {
        throw new Error("Escreva o texto da mensagem rápida");
      }
      if (form.action_type === "flow" && !form.flow_id) {
        throw new Error("Escolha o fluxo que o atalho deve ativar");
      }

      const payload = {
        command,
        description: form.description.trim() || null,
        action_type: form.action_type,
        message: form.action_type === "message" ? form.message.trim() : null,
        flow_id: form.action_type === "flow" ? form.flow_id : null,
      };

      // O atalho pertence à CONTA, não a quem clicou: um gerente criando em
      // nome do dono precisa que a equipe inteira enxergue o comando.
      const ownerId = team?.ownerId ?? user.id;

      const { error } = editingId
        ? await supabase.from("chat_shortcuts").update(payload).eq("id", editingId)
        : await supabase.from("chat_shortcuts").insert({ ...payload, user_id: ownerId });

      if (error) {
        // Índice único em (user_id, lower(command)).
        if (error.code === "23505" || error.message.includes("duplicate")) {
          throw new Error(`Já existe um atalho /${command}`);
        }
        throw error;
      }
    },
    onSuccess: () => {
      toast({ title: editingId ? "Atalho atualizado" : "Atalho criado" });
      setForm(EMPTY_FORM);
      setCreating(false);
      setEditingId(null);
      invalidate();
    },
    onError: (e: any) =>
      toast({ title: "Erro ao salvar atalho", description: e.message, variant: "destructive" }),
  });

  const openEdit = (s: ChatShortcut) => {
    setEditingId(s.id);
    setForm({
      command: s.command,
      description: s.description ?? "",
      action_type: s.action_type,
      message: s.message ?? "",
      flow_id: s.flow_id ?? "",
    });
    setCreating(true);
  };

  const closeForm = () => {
    setCreating(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from("chat_shortcuts").update({ active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: any) =>
      toast({ title: "Erro ao atualizar", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("chat_shortcuts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Atalho removido" });
      invalidate();
    },
    onError: (e: any) =>
      toast({ title: "Erro ao remover", description: e.message, variant: "destructive" }),
  });

  const flowName = (id: string | null) =>
    flows?.find((f: any) => f.id === id)?.name || "Fluxo removido";

  return (
    <Card className="glass-card">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Zap size={18} className="text-primary" />
              Atalhos do chat
            </CardTitle>
            <CardDescription>
              Digite <code className="px-1 rounded bg-muted">/</code> no chat para listar os atalhos.
              Um atalho pode enviar uma mensagem rápida ou ativar um fluxo já criado.
            </CardDescription>
          </div>
          {!creating && (
            <Button size="sm" onClick={() => setCreating(true)} className="gap-1.5 flex-shrink-0">
              <Plus size={15} /> Novo atalho
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {creating && (
          <div className="rounded-lg border border-border p-4 space-y-4 bg-card/50">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Comando</Label>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground text-sm">/</span>
                  <Input
                    value={form.command}
                    onChange={(e) => setForm({ ...form, command: e.target.value })}
                    placeholder="fluxo1"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>O que o atalho faz</Label>
                <Select
                  value={form.action_type}
                  onValueChange={(v: ActionType) => setForm({ ...form, action_type: v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="message">Mensagem rápida</SelectItem>
                    <SelectItem value="flow">Ativar um fluxo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Descrição (opcional)</Label>
              <Input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Ex.: Boas-vindas com link da live"
              />
            </div>

            {form.action_type === "message" ? (
              <div className="space-y-1.5">
                <Label>Mensagem</Label>
                <Textarea
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  placeholder="Olá {nome}, tudo bem? Consegue me confirmar seu e-mail?"
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">
                  Use <code className="px-1 rounded bg-muted">{"{nome}"}</code> para o nome do lead.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>Fluxo</Label>
                <Select
                  value={form.flow_id}
                  onValueChange={(v) => setForm({ ...form, flow_id: v })}
                >
                  <SelectTrigger><SelectValue placeholder="Escolha um fluxo" /></SelectTrigger>
                  <SelectContent>
                    {(flows || []).map((f: any) => (
                      <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(flows || []).length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Nenhum fluxo criado ainda. Crie um no Flow Builder.
                  </p>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className="gap-1.5"
              >
                {saveMutation.isPending && <Loader2 size={15} className="animate-spin" />}
                {editingId ? "Salvar alterações" : "Salvar atalho"}
              </Button>
              <Button variant="ghost" onClick={closeForm}>
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 size={15} className="animate-spin" /> Carregando atalhos...
          </div>
        ) : (shortcuts || []).length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            Nenhum atalho criado. Crie o primeiro — ele fica disponível no chat digitando “/”.
          </p>
        ) : (
          <div className="space-y-2">
            {(shortcuts || []).map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-3 rounded-lg border border-border p-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="text-sm font-medium text-primary">/{s.command}</code>
                    <Badge variant="secondary" className="text-[11px]">
                      {s.action_type === "flow" ? "Fluxo" : "Mensagem"}
                    </Badge>
                    {!s.active && (
                      <Badge variant="outline" className="text-[11px]">Inativo</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                    {s.description
                      || (s.action_type === "flow" ? flowName(s.flow_id) : s.message)}
                  </p>
                </div>
                <Switch
                  checked={s.active}
                  onCheckedChange={(active) => toggleMutation.mutate({ id: s.id, active })}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => openEdit(s)}
                  title="Editar atalho"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Pencil size={16} />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => deleteMutation.mutate(s.id)}
                  title="Remover atalho"
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 size={16} />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
