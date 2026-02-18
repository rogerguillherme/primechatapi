import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Plus, Trash2, GripVertical, Clock, MessageSquare, GitBranch,
  ChevronDown, ChevronRight, Play, Pause, ArrowLeft, Save, MousePointerClick,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface FlowStep {
  id?: string;
  flow_id?: string;
  step_order: number;
  step_type: "message" | "delay" | "condition" | "interactive_buttons" | "cta_url";
  template_id: string | null;
  custom_message: string | null;
  delay_minutes: number;
  trigger_value: string | null;
  parent_step_id: string | null;
  buttons: { id: string; title: string; url?: string }[];
}

interface Flow {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  created_at: string;
}

/* ── Flow List View ── */
function FlowListView({ onEdit }: { onEdit: (flow: Flow | null) => void }) {
  const queryClient = useQueryClient();

  const { data: flows, isLoading } = useQuery({
    queryKey: ["flows"],
    queryFn: async () => {
      const { data } = await supabase
        .from("flows")
        .select("*")
        .order("created_at", { ascending: false });
      return (data || []) as Flow[];
    },
  });

  const { data: stepCounts } = useQuery({
    queryKey: ["flow-step-counts"],
    queryFn: async () => {
      const { data } = await supabase.from("flow_steps").select("flow_id");
      const counts = new Map<string, number>();
      for (const s of data || []) {
        counts.set(s.flow_id, (counts.get(s.flow_id) || 0) + 1);
      }
      return counts;
    },
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from("flows").update({ active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["flows"] }),
    onError: (err: any) => toast.error(err.message),
  });

  const deleteFlow = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("flows").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["flows"] });
      toast.success("Fluxo removido.");
    },
    onError: (err: any) => toast.error(err.message),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <GitBranch size={18} />
            Fluxos de Automação
          </CardTitle>
          <CardDescription>Crie sequências de mensagens com delays e condições de botão.</CardDescription>
        </div>
        <Button size="sm" onClick={() => onEdit(null)}>
          <Plus size={14} /> Novo Fluxo
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <p className="text-sm text-muted-foreground text-center py-8">Carregando...</p>
        ) : !flows?.length ? (
          <p className="text-sm text-muted-foreground text-center py-8">Nenhum fluxo criado ainda.</p>
        ) : (
          <div className="divide-y divide-border">
            {flows.map((flow) => (
              <div key={flow.id} className="flex items-center gap-3 px-4 py-3 hover:bg-accent/30 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">{flow.name}</p>
                    <Badge variant={flow.active ? "default" : "secondary"} className="text-[10px]">
                      {flow.active ? "Ativo" : "Inativo"}
                    </Badge>
                  </div>
                  {flow.description && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{flow.description}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {stepCounts?.get(flow.id) || 0} passo(s)
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => toggleActive.mutate({ id: flow.id, active: !flow.active })}
                    title={flow.active ? "Desativar" : "Ativar"}
                  >
                    {flow.active ? <Pause size={14} /> : <Play size={14} />}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(flow)}>
                    <ChevronRight size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => { if (confirm("Remover fluxo?")) deleteFlow.mutate(flow.id); }}
                  >
                    <Trash2 size={14} />
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

/* ── Flow Editor View ── */
function FlowEditorView({ flow, onBack }: { flow: Flow | null; onBack: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(flow?.name || "");
  const [description, setDescription] = useState(flow?.description || "");
  const [steps, setSteps] = useState<FlowStep[]>([]);
  const [isLoaded, setIsLoaded] = useState(!flow);

  const { data: templates } = useQuery({
    queryKey: ["flow-templates"],
    queryFn: async () => {
      const { data } = await supabase.from("chat_templates").select("*").order("name");
      return data || [];
    },
  });

  // Load existing steps
  useQuery({
    queryKey: ["flow-steps", flow?.id],
    queryFn: async () => {
      if (!flow) return [];
      const { data } = await supabase
        .from("flow_steps")
        .select("*")
        .eq("flow_id", flow.id)
        .order("step_order");
      const loaded = (data || []).map((s: any) => ({
        id: s.id,
        flow_id: s.flow_id,
        step_order: s.step_order,
        step_type: s.step_type as FlowStep["step_type"],
        template_id: s.template_id,
        custom_message: s.custom_message,
        delay_minutes: s.delay_minutes || 0,
        trigger_value: s.trigger_value,
        parent_step_id: s.parent_step_id,
        buttons: Array.isArray(s.buttons) ? s.buttons : [],
      }));
      setSteps(loaded);
      setIsLoaded(true);
      return loaded;
    },
    enabled: !!flow,
  });

  const addStep = (type: FlowStep["step_type"]) => {
    setSteps((prev) => [
      ...prev,
      {
        step_order: prev.length,
        step_type: type,
        template_id: null,
        custom_message: null,
        delay_minutes: type === "delay" ? 60 : 0,
        trigger_value: type === "condition" ? "" : null,
        parent_step_id: null,
        buttons: type === "interactive_buttons" ? [{ id: crypto.randomUUID(), title: "" }]
          : type === "cta_url" ? [{ id: crypto.randomUUID(), title: "Acessar site", url: "" }]
          : [],
      },
    ]);
  };

  const removeStep = (index: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, step_order: i })));
  };

  const updateStep = (index: number, updates: Partial<FlowStep>) => {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...updates } : s)));
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Nome do fluxo é obrigatório.");

      let flowId = flow?.id;

      if (flowId) {
        const { error } = await supabase.from("flows").update({ name, description: description || null }).eq("id", flowId);
        if (error) throw error;
        // Delete old steps and re-create
        await supabase.from("flow_steps").delete().eq("flow_id", flowId);
      } else {
        const { data, error } = await supabase.from("flows").insert({ name, description: description || null }).select("id").single();
        if (error) throw error;
        flowId = data.id;
      }

      // Insert steps
      if (steps.length > 0) {
        const stepsToInsert = steps.map((s, i) => ({
          flow_id: flowId!,
          step_order: i,
          step_type: s.step_type,
          template_id: s.template_id || null,
          custom_message: s.custom_message || null,
          delay_minutes: s.delay_minutes || 0,
          trigger_value: s.trigger_value || null,
          parent_step_id: null,
          buttons: (s.step_type === "interactive_buttons" || s.step_type === "cta_url") ? s.buttons : [],
        }));
        const { error } = await supabase.from("flow_steps").insert(stepsToInsert);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["flows"] });
      queryClient.invalidateQueries({ queryKey: ["flow-step-counts"] });
      toast.success("Fluxo salvo com sucesso!");
      onBack();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const stepTypeLabel = (type: string) => {
    switch (type) {
      case "message": return "Mensagem";
      case "delay": return "Delay";
      case "condition": return "Condição (botão)";
      case "interactive_buttons": return "Mensagem com Botões";
      case "cta_url": return "Botão com Link";
      default: return type;
    }
  };

  const stepTypeIcon = (type: string) => {
    switch (type) {
      case "message": return <MessageSquare size={14} />;
      case "delay": return <Clock size={14} />;
      case "condition": return <GitBranch size={14} />;
      case "interactive_buttons": return <MousePointerClick size={14} />;
      case "cta_url": return <ExternalLink size={14} />;
      default: return null;
    }
  };

  // stepTypeIcon defined above

  if (!isLoaded) return <p className="text-sm text-muted-foreground text-center py-8">Carregando...</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack}>
          <ArrowLeft size={16} />
        </Button>
        <h3 className="text-base font-medium">{flow ? "Editar Fluxo" : "Novo Fluxo"}</h3>
      </div>

      <Card>
        <CardContent className="pt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Nome do fluxo</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Boas-vindas" />
            </div>
            <div className="space-y-2">
              <Label>Descrição (opcional)</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex: Fluxo para novos leads" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Steps */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Passos do Fluxo</CardTitle>
          <CardDescription>Adicione mensagens, delays e condições de botão em sequência.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {steps.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">Nenhum passo adicionado. Adicione o primeiro passo abaixo.</p>
          )}

          {steps.map((step, index) => (
            <div key={index} className="rounded-lg border border-border p-3 space-y-3 bg-muted/20">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px]">
                    {index + 1}
                  </span>
                  {stepTypeIcon(step.step_type)}
                  {stepTypeLabel(step.step_type)}
                </div>
                <div className="flex-1" />
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeStep(index)}>
                  <Trash2 size={13} />
                </Button>
              </div>

              {step.step_type === "message" && (
                <div className="space-y-2">
                  <Label className="text-xs">Template</Label>
                  <Select
                    value={step.template_id || "custom"}
                    onValueChange={(v) => updateStep(index, { template_id: v === "custom" ? null : v })}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="custom">Mensagem personalizada</SelectItem>
                      {templates?.map((t: any) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name} {t.template_name ? `(${t.template_name})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!step.template_id && (
                    <textarea
                      value={step.custom_message || ""}
                      onChange={(e) => updateStep(index, { custom_message: e.target.value })}
                      placeholder="Digite a mensagem... (use {nome} para personalizar)"
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      rows={2}
                    />
                  )}
                </div>
              )}

              {step.step_type === "delay" && (
                <div className="flex items-center gap-2">
                  <Label className="text-xs whitespace-nowrap">Aguardar</Label>
                  <Input
                    type="number"
                    min={1}
                    value={step.delay_minutes}
                    onChange={(e) => updateStep(index, { delay_minutes: parseInt(e.target.value) || 1 })}
                    className="w-20 h-8 text-sm"
                  />
                  <span className="text-xs text-muted-foreground">minutos</span>
                  {step.delay_minutes >= 60 && (
                    <span className="text-xs text-muted-foreground">
                      ({Math.floor(step.delay_minutes / 60)}h{step.delay_minutes % 60 > 0 ? ` ${step.delay_minutes % 60}min` : ""})
                    </span>
                  )}
                </div>
              )}

              {step.step_type === "condition" && (
                <div className="space-y-2">
                  <Label className="text-xs">Texto do botão clicado (payload)</Label>
                  <Input
                    value={step.trigger_value || ""}
                    onChange={(e) => updateStep(index, { trigger_value: e.target.value })}
                    placeholder="Ex: sim, quero_saber_mais"
                    className="h-8 text-sm"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    O fluxo só avança a partir deste passo se o lead clicar no botão com este payload.
                  </p>
                </div>
              )}

              {step.step_type === "interactive_buttons" && (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label className="text-xs">Texto da mensagem</Label>
                    <textarea
                      value={step.custom_message || ""}
                      onChange={(e) => updateStep(index, { custom_message: e.target.value })}
                      placeholder="Digite a mensagem que aparecerá acima dos botões... (use {nome} para personalizar)"
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      rows={2}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Botões (máx. 3)</Label>
                    {step.buttons.map((btn, btnIdx) => (
                      <div key={btn.id} className="flex items-center gap-2">
                        <Input
                          value={btn.title}
                          onChange={(e) => {
                            const newButtons = [...step.buttons];
                            newButtons[btnIdx] = { ...btn, title: e.target.value };
                            updateStep(index, { buttons: newButtons });
                          }}
                          placeholder={`Botão ${btnIdx + 1}`}
                          className="h-8 text-sm"
                          maxLength={20}
                        />
                        {step.buttons.length > 1 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive shrink-0"
                            onClick={() => {
                              const newButtons = step.buttons.filter((_, i) => i !== btnIdx);
                              updateStep(index, { buttons: newButtons });
                            }}
                          >
                            <Trash2 size={12} />
                          </Button>
                        )}
                      </div>
                    ))}
                    {step.buttons.length < 3 && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs gap-1"
                        onClick={() => {
                          const newButtons = [...step.buttons, { id: crypto.randomUUID(), title: "" }];
                          updateStep(index, { buttons: newButtons });
                        }}
                      >
                        <Plus size={12} /> Adicionar botão
                      </Button>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Use com um passo "Condição" logo depois para capturar o clique do botão.
                  </p>
                </div>
              )}

              {step.step_type === "cta_url" && (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label className="text-xs">Texto da mensagem</Label>
                    <textarea
                      value={step.custom_message || ""}
                      onChange={(e) => updateStep(index, { custom_message: e.target.value })}
                      placeholder="Digite a mensagem acima do botão... (use {nome} para personalizar)"
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      rows={2}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Texto do botão</Label>
                    <Input
                      value={step.buttons[0]?.title || ""}
                      onChange={(e) => {
                        const btn = step.buttons[0] || { id: crypto.randomUUID(), title: "", url: "" };
                        updateStep(index, { buttons: [{ ...btn, title: e.target.value }] });
                      }}
                      placeholder="Ex: Acessar site"
                      className="h-8 text-sm"
                      maxLength={20}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">URL do link</Label>
                    <Input
                      value={step.buttons[0]?.url || ""}
                      onChange={(e) => {
                        const btn = step.buttons[0] || { id: crypto.randomUUID(), title: "Acessar site", url: "" };
                        updateStep(index, { buttons: [{ ...btn, url: e.target.value }] });
                      }}
                      placeholder="https://exemplo.com"
                      className="h-8 text-sm"
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    O lead verá um botão clicável que abre o link diretamente no navegador.
                  </p>
                </div>
              )}
            </div>
          ))}

          {/* Connector lines between steps */}
          {steps.length > 0 && (
            <div className="flex justify-center">
              <div className="w-px h-4 bg-border" />
            </div>
          )}

          {/* Add step buttons */}
          <div className="flex flex-wrap gap-2 justify-center pt-1">
            <Button variant="outline" size="sm" onClick={() => addStep("message")} className="gap-1.5 text-xs">
              <MessageSquare size={12} /> Mensagem
            </Button>
            <Button variant="outline" size="sm" onClick={() => addStep("delay")} className="gap-1.5 text-xs">
              <Clock size={12} /> Delay
            </Button>
            <Button variant="outline" size="sm" onClick={() => addStep("condition")} className="gap-1.5 text-xs">
              <GitBranch size={12} /> Condição
            </Button>
            <Button variant="outline" size="sm" onClick={() => addStep("interactive_buttons")} className="gap-1.5 text-xs">
              <MousePointerClick size={12} /> Msg com Botões
            </Button>
            <Button variant="outline" size="sm" onClick={() => addStep("cta_url")} className="gap-1.5 text-xs">
              <ExternalLink size={12} /> Botão com Link
            </Button>
          </div>

          <div className="pt-2">
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="w-full">
              <Save size={14} />
              {saveMutation.isPending ? "Salvando..." : "Salvar Fluxo"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ── Main FlowBuilder Component ── */
export function FlowBuilder() {
  const [editingFlow, setEditingFlow] = useState<Flow | null | undefined>(undefined);
  // undefined = list view, null = new flow, Flow = editing

  if (editingFlow !== undefined) {
    return <FlowEditorView flow={editingFlow} onBack={() => setEditingFlow(undefined)} />;
  }

  return <FlowListView onEdit={(flow) => setEditingFlow(flow)} />;
}
