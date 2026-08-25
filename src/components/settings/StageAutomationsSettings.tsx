import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus, Trash2, Workflow } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type TriggerType = "inbound_message" | "keyword" | "outbound_message" | "send_failed";

const TRIGGERS: { value: TriggerType; label: string; hint: string }[] = [
  { value: "inbound_message", label: "Lead respondeu", hint: "Qualquer mensagem recebida do lead" },
  { value: "keyword", label: "Palavra-chave recebida", hint: "A mensagem do lead contém uma das palavras" },
  { value: "outbound_message", label: "Mensagem enviada", hint: "Quando enviamos uma mensagem para o lead" },
  { value: "send_failed", label: "Falha no envio", hint: "Quando a Meta recusa a mensagem" },
];

interface StageAutomation {
  id: string;
  name: string;
  active: boolean;
  trigger_type: TriggerType;
  keywords: string[];
  from_stage_id: string | null;
  to_stage_id: string;
}

const EMPTY_FORM = {
  name: "",
  trigger_type: "inbound_message" as TriggerType,
  keywords: "",
  from_stage_id: "any",
  to_stage_id: "",
};

export function StageAutomationsSettings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);

  const { data: stages } = useQuery({
    queryKey: ["pipeline-stages-automations"],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipeline_stages")
        .select("id, name, position")
        .order("position");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: automations, isLoading } = useQuery({
    queryKey: ["stage-automations", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stage_automations")
        .select("id, name, active, trigger_type, keywords, from_stage_id, to_stage_id")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as StageAutomation[];
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["stage-automations", user?.id] });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Sessão expirada");
      if (!form.name.trim()) throw new Error("Dê um nome para a regra");
      if (!form.to_stage_id) throw new Error("Escolha a etapa de destino");
      const keywords = form.keywords
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);
      if (form.trigger_type === "keyword" && keywords.length === 0) {
        throw new Error("Informe ao menos uma palavra-chave");
      }
      const { error } = await supabase.from("stage_automations").insert({
        user_id: user.id,
        name: form.name.trim(),
        trigger_type: form.trigger_type,
        keywords,
        from_stage_id: form.from_stage_id === "any" ? null : form.from_stage_id,
        to_stage_id: form.to_stage_id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Regra criada" });
      setForm(EMPTY_FORM);
      setCreating(false);
      invalidate();
    },
    onError: (err: any) => {
      toast({ title: "Erro ao criar regra", description: err.message, variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from("stage_automations").update({ active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("stage_automations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Regra removida" });
      invalidate();
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  const stageName = (id: string | null) =>
    id ? (stages || []).find((s) => s.id === id)?.name || "—" : "Qualquer etapa";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Workflow size={20} />
              Fluxos automáticos de etapa (Kanban)
            </CardTitle>
            <CardDescription>
              Mova o lead de coluna automaticamente quando algo acontecer na conversa.
            </CardDescription>
          </div>
          <Button size="sm" variant={creating ? "secondary" : "default"} onClick={() => setCreating((v) => !v)}>
            <Plus size={16} className="mr-1" />
            {creating ? "Cancelar" : "Nova regra"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {(!stages || stages.length === 0) && (
          <p className="text-sm text-muted-foreground">
            Crie as colunas do Kanban primeiro para poder configurar as regras.
          </p>
        )}

        {creating && stages && stages.length > 0 && (
          <div className="rounded-lg border border-border p-4 space-y-3 bg-muted/20">
            <div className="space-y-1.5">
              <Label htmlFor="sa-name">Nome da regra</Label>
              <Input
                id="sa-name"
                placeholder="Ex.: Respondeu → Em atendimento"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Gatilho</Label>
                <Select
                  value={form.trigger_type}
                  onValueChange={(v) => setForm((f) => ({ ...f, trigger_type: v as TriggerType }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TRIGGERS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {TRIGGERS.find((t) => t.value === form.trigger_type)?.hint}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label>Etapa de origem</Label>
                <Select
                  value={form.from_stage_id}
                  onValueChange={(v) => setForm((f) => ({ ...f, from_stage_id: v }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Qualquer etapa</SelectItem>
                    {stages.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {form.trigger_type === "keyword" && (
              <div className="space-y-1.5">
                <Label htmlFor="sa-keywords">Palavras-chave (separadas por vírgula)</Label>
                <Input
                  id="sa-keywords"
                  placeholder="quero, comprar, preço"
                  value={form.keywords}
                  onChange={(e) => setForm((f) => ({ ...f, keywords: e.target.value }))}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Mover para a etapa</Label>
              <Select
                value={form.to_stage_id}
                onValueChange={(v) => setForm((f) => ({ ...f, to_stage_id: v }))}
              >
                <SelectTrigger><SelectValue placeholder="Selecione a etapa de destino" /></SelectTrigger>
                <SelectContent>
                  {stages.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
              {createMutation.isPending && <Loader2 size={16} className="mr-2 animate-spin" />}
              Salvar regra
            </Button>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={16} className="animate-spin" /> Carregando regras...
          </div>
        ) : !automations || automations.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma regra configurada ainda.</p>
        ) : (
          <div className="space-y-2">
            {automations.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
                <div className="min-w-0">
                  <p className="font-medium truncate">{a.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {TRIGGERS.find((t) => t.value === a.trigger_type)?.label} · {stageName(a.from_stage_id)} → {stageName(a.to_stage_id)}
                  </p>
                  {a.trigger_type === "keyword" && a.keywords.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {a.keywords.map((k) => (
                        <Badge key={k} variant="outline" className="text-[10px]">{k}</Badge>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Switch
                    checked={a.active}
                    onCheckedChange={(checked) => toggleMutation.mutate({ id: a.id, active: checked })}
                  />
                  <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(a.id)}>
                    <Trash2 size={16} className="text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
