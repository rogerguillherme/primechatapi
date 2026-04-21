import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Plus, Zap, Clock, Trash2, Instagram, Send, MessageCircle,
  ArrowRight, Eye, Pencil, Copy, ChevronDown, ChevronUp, Sparkles, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AutomationTemplatesModal, type AutomationTemplate } from "./AutomationTemplatesModal";

interface FlowStep {
  id: string;
  type: "reply_comment" | "send_dm" | "delay";
  message: string;
  delay_seconds?: number;
}

interface AutomationFlow {
  id: string;
  name: string;
  trigger_type: "comment_keyword" | "any_comment" | "story_mention";
  keywords: string[];
  steps: FlowStep[];
  active: boolean;
  created_at: string;
}

const STEP_CONFIG = {
  reply_comment: { icon: MessageCircle, label: "Responder Comentário", color: "text-green-500", bg: "bg-green-500/10" },
  send_dm: { icon: Send, label: "Enviar Direct", color: "text-blue-500", bg: "bg-blue-500/10" },
  delay: { icon: Clock, label: "Aguardar", color: "text-yellow-500", bg: "bg-yellow-500/10" },
};

export function InstagramAutomations() {
  const { user } = useAuth();
  const [flows, setFlows] = useState<AutomationFlow[]>([]);
  const [editingFlow, setEditingFlow] = useState<AutomationFlow | null>(null);
  const [expandedFlow, setExpandedFlow] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);

  const createFromTemplate = (template: AutomationTemplate) => {
    setEditingFlow({
      id: crypto.randomUUID(),
      name: template.flow.name,
      trigger_type: template.trigger,
      keywords: template.keywords || [],
      active: true,
      created_at: new Date().toISOString(),
      steps: template.flow.steps.map((s) => ({
        id: crypto.randomUUID(),
        type: s.type,
        message: s.message,
        delay_seconds: s.delay_seconds || 5,
      })),
    });
    toast.success(`Modelo "${template.title}" carregado — ajuste e salve!`);
  };

  const loadFlows = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data: automations, error } = await supabase
        .from("instagram_automations")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const flowsWithSteps: AutomationFlow[] = [];
      for (const auto of automations || []) {
        const { data: steps } = await supabase
          .from("instagram_automation_steps")
          .select("*")
          .eq("automation_id", auto.id)
          .order("step_order", { ascending: true });

        flowsWithSteps.push({
          id: auto.id,
          name: auto.name,
          trigger_type: auto.trigger_type as AutomationFlow["trigger_type"],
          keywords: auto.keywords || [],
          active: auto.active,
          created_at: auto.created_at,
          steps: (steps || []).map((s) => ({
            id: s.id,
            type: s.step_type as FlowStep["type"],
            message: s.message || "",
            delay_seconds: s.delay_seconds || 5,
          })),
        });
      }
      setFlows(flowsWithSteps);
    } catch (e) {
      console.error("Error loading automations:", e);
      toast.error("Erro ao carregar automações");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { loadFlows(); }, [loadFlows]);

  const createNewFlow = () => {
    setEditingFlow({
      id: crypto.randomUUID(),
      name: "",
      trigger_type: "comment_keyword",
      keywords: [],
      steps: [
        { id: crypto.randomUUID(), type: "reply_comment", message: "" },
        { id: crypto.randomUUID(), type: "delay", message: "", delay_seconds: 5 },
        { id: crypto.randomUUID(), type: "send_dm", message: "" },
      ],
      active: true,
      created_at: new Date().toISOString(),
    });
  };

  const saveFlow = async () => {
    if (!editingFlow || !user) return;
    if (!editingFlow.name.trim()) { toast.error("Dê um nome ao fluxo"); return; }
    const hasEmptyStep = editingFlow.steps.some((s) => s.type !== "delay" && !s.message.trim());
    if (hasEmptyStep) { toast.error("Preencha todas as mensagens do fluxo"); return; }

    setSaving(true);
    try {
      const exists = flows.find((f) => f.id === editingFlow.id);

      if (exists) {
        await supabase.from("instagram_automations").update({
          name: editingFlow.name,
          trigger_type: editingFlow.trigger_type,
          keywords: editingFlow.keywords,
          active: editingFlow.active,
        }).eq("id", editingFlow.id);

        // Delete old steps and re-insert
        await supabase.from("instagram_automation_steps").delete().eq("automation_id", editingFlow.id);
      } else {
        await supabase.from("instagram_automations").insert({
          id: editingFlow.id,
          user_id: user.id,
          name: editingFlow.name,
          trigger_type: editingFlow.trigger_type,
          keywords: editingFlow.keywords,
          active: editingFlow.active,
        });
      }

      // Insert steps
      if (editingFlow.steps.length > 0) {
        await supabase.from("instagram_automation_steps").insert(
          editingFlow.steps.map((s, idx) => ({
            automation_id: editingFlow.id,
            step_order: idx,
            step_type: s.type,
            message: s.message,
            delay_seconds: s.delay_seconds || 5,
          }))
        );
      }

      setEditingFlow(null);
      toast.success("Fluxo salvo com sucesso!");
      await loadFlows();
    } catch (e) {
      console.error("Error saving flow:", e);
      toast.error("Erro ao salvar fluxo");
    } finally {
      setSaving(false);
    }
  };

  const deleteFlow = async (id: string) => {
    await supabase.from("instagram_automations").delete().eq("id", id);
    setFlows((prev) => prev.filter((f) => f.id !== id));
    toast.success("Fluxo removido");
  };

  const duplicateFlow = async (flow: AutomationFlow) => {
    if (!user) return;
    const newId = crypto.randomUUID();
    await supabase.from("instagram_automations").insert({
      id: newId,
      user_id: user.id,
      name: `${flow.name} (cópia)`,
      trigger_type: flow.trigger_type,
      keywords: flow.keywords,
      active: false,
    });
    if (flow.steps.length > 0) {
      await supabase.from("instagram_automation_steps").insert(
        flow.steps.map((s, idx) => ({
          automation_id: newId,
          step_order: idx,
          step_type: s.type,
          message: s.message,
          delay_seconds: s.delay_seconds || 5,
        }))
      );
    }
    toast.success("Fluxo duplicado");
    await loadFlows();
  };

  const toggleFlow = async (id: string, active: boolean) => {
    await supabase.from("instagram_automations").update({ active }).eq("id", id);
    setFlows((prev) => prev.map((f) => (f.id === id ? { ...f, active } : f)));
  };

  const addStep = (type: FlowStep["type"]) => {
    if (!editingFlow) return;
    setEditingFlow({
      ...editingFlow,
      steps: [...editingFlow.steps, {
        id: crypto.randomUUID(), type, message: "",
        ...(type === "delay" ? { delay_seconds: 5 } : {}),
      }],
    });
  };

  const updateStep = (stepId: string, data: Partial<FlowStep>) => {
    if (!editingFlow) return;
    setEditingFlow({
      ...editingFlow,
      steps: editingFlow.steps.map((s) => (s.id === stepId ? { ...s, ...data } : s)),
    });
  };

  const removeStep = (stepId: string) => {
    if (!editingFlow) return;
    setEditingFlow({ ...editingFlow, steps: editingFlow.steps.filter((s) => s.id !== stepId) });
  };

  const moveStep = (stepId: string, direction: "up" | "down") => {
    if (!editingFlow) return;
    const idx = editingFlow.steps.findIndex((s) => s.id === stepId);
    if ((direction === "up" && idx === 0) || (direction === "down" && idx === editingFlow.steps.length - 1)) return;
    const newSteps = [...editingFlow.steps];
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    [newSteps[idx], newSteps[swapIdx]] = [newSteps[swapIdx], newSteps[idx]];
    setEditingFlow({ ...editingFlow, steps: newSteps });
  };

  // --- EDITOR VIEW ---
  if (editingFlow) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">
            {flows.find((f) => f.id === editingFlow.id) ? "Editar Fluxo" : "Novo Fluxo"}
          </h2>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setEditingFlow(null)}>Cancelar</Button>
            <Button onClick={saveFlow} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Salvar Fluxo
            </Button>
          </div>
        </div>

        <Card><CardContent className="pt-5 space-y-4">
          <div className="space-y-2">
            <Label>Nome do fluxo</Label>
            <Input placeholder="Ex: Promoção Black Friday" value={editingFlow.name}
              onChange={(e) => setEditingFlow({ ...editingFlow, name: e.target.value })} />
          </div>
        </CardContent></Card>

        <Card className="border-pink-500/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-pink-500/10 flex items-center justify-center">
                <Instagram size={16} className="text-pink-500" />
              </div>
              Gatilho — Quando acontecer...
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Tipo de gatilho</Label>
              <Select value={editingFlow.trigger_type}
                onValueChange={(v: AutomationFlow["trigger_type"]) => setEditingFlow({ ...editingFlow, trigger_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="comment_keyword">Comentário com palavra-chave</SelectItem>
                  <SelectItem value="any_comment">Qualquer comentário</SelectItem>
                  <SelectItem value="story_mention">Menção no Story</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {editingFlow.trigger_type === "comment_keyword" && (
              <div className="space-y-2">
                <Label>Palavras-chave (separadas por vírgula)</Label>
                <Input placeholder="Ex: preço, quero, link, promoção" value={editingFlow.keywords.join(", ")}
                  onChange={(e) => setEditingFlow({
                    ...editingFlow,
                    keywords: e.target.value.split(",").map((k) => k.trim()).filter(Boolean),
                  })} />
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {editingFlow.keywords.map((kw, i) => (
                    <Badge key={i} variant="secondary" className="text-xs">{kw}</Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Etapas do Fluxo</h3>
          {editingFlow.steps.map((step, idx) => {
            const config = STEP_CONFIG[step.type];
            const Icon = config.icon;
            return (
              <div key={step.id}>
                {idx > 0 && (
                  <div className="flex justify-center py-1">
                    <ArrowRight size={16} className="text-muted-foreground/40 rotate-90" />
                  </div>
                )}
                <Card className="border-l-4" style={{ borderLeftColor: step.type === "reply_comment" ? "#22c55e" : step.type === "send_dm" ? "#3b82f6" : "#eab308" }}>
                  <CardContent className="pt-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-lg ${config.bg} flex items-center justify-center`}>
                          <Icon size={16} className={config.color} />
                        </div>
                        <span className="text-sm font-medium">{config.label}</span>
                        <Badge variant="outline" className="text-[10px]">Etapa {idx + 1}</Badge>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => moveStep(step.id, "up")} disabled={idx === 0}>
                          <ChevronUp size={14} />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => moveStep(step.id, "down")} disabled={idx === editingFlow.steps.length - 1}>
                          <ChevronDown size={14} />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeStep(step.id)}>
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </div>
                    {step.type === "delay" ? (
                      <div className="space-y-2">
                        <Label>Tempo de espera (segundos)</Label>
                        <Input type="number" min={1} value={step.delay_seconds || 5}
                          onChange={(e) => updateStep(step.id, { delay_seconds: Number(e.target.value) })} className="max-w-[140px]" />
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Label>{step.type === "reply_comment" ? "Resposta(s) ao comentário" : "Mensagem(ns) no Direct"}</Label>
                        <Textarea
                          placeholder={step.type === "reply_comment"
                            ? "Ex: Obrigado pelo comentário! 🙌\n\n💡 Para várias respostas (escolha aleatória), separe com |||\nEx: Obrigado! ||| Adorei seu comentário ❤️ ||| Que legal! 🚀"
                            : "Ex: Oi {{nome}}! Vi seu comentário 🎁\n\n💡 Para várias mensagens, separe com |||"}
                          value={step.message}
                          onChange={(e) => updateStep(step.id, { message: e.target.value })} rows={5} />
                        <div className="flex items-center justify-between">
                          <p className="text-[11px] text-muted-foreground">
                            Variáveis: {"{{nome}}"} · {"{{comentario}}"} · Separe respostas com <code className="text-pink-500 font-mono">|||</code>
                          </p>
                          <Button type="button" variant="ghost" size="sm" className="h-6 text-[11px] gap-1"
                            onClick={() => updateStep(step.id, { message: (step.message || "") + (step.message ? " ||| " : "") })}>
                            <Plus size={10} /> variante
                          </Button>
                        </div>
                        {step.message && step.message.includes("|||") && (
                          <div className="text-[11px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 rounded px-2 py-1">
                            ✨ {step.message.split("|||").filter((s) => s.trim()).length} variantes detectadas — uma será escolhida aleatoriamente
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-2 pt-2">
          <span className="text-xs text-muted-foreground">Adicionar etapa:</span>
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => addStep("reply_comment")}>
            <MessageCircle size={12} /> Responder Comentário
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => addStep("delay")}>
            <Clock size={12} /> Delay
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => addStep("send_dm")}>
            <Send size={12} /> Enviar DM
          </Button>
        </div>
      </div>
    );
  }

  // --- LIST VIEW ---
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Fluxos do Instagram</h2>
          <p className="text-sm text-muted-foreground">Crie fluxos automáticos: comentário → resposta → DM</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={createNewFlow} className="gap-2">
            <Plus className="h-4 w-4" /> Do Zero
          </Button>
          <Button onClick={() => setTemplatesOpen(true)} className="gap-2 bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600">
            <Sparkles className="h-4 w-4" /> Usar modelo
          </Button>
        </div>
      </div>

      <AutomationTemplatesModal
        open={templatesOpen}
        onOpenChange={setTemplatesOpen}
        onSelect={createFromTemplate}
        onStartBlank={createNewFlow}
      />

      {flows.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-pink-500/10 to-purple-500/10 flex items-center justify-center mb-4">
              <Zap className="h-8 w-8 text-pink-500/40" />
            </div>
            <p className="text-lg font-medium text-muted-foreground">Nenhum fluxo criado</p>
            <p className="text-sm text-muted-foreground mt-1 text-center max-w-sm">
              Crie um fluxo para responder comentários automaticamente e enviar mensagens no Direct
            </p>
            <Button onClick={() => setTemplatesOpen(true)} variant="outline" className="mt-4 gap-2">
              <Sparkles size={14} /> Escolher um modelo
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {flows.map((flow) => (
            <Card key={flow.id} className="hover:shadow-md transition-shadow">
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-pink-500/10 to-purple-500/10 flex items-center justify-center shrink-0">
                      <Instagram className="h-5 w-5 text-pink-500" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium truncate">{flow.name}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <Badge variant="outline" className="text-[10px]">
                          {flow.trigger_type === "comment_keyword"
                            ? `Palavra-chave: ${flow.keywords.join(", ")}`
                            : flow.trigger_type === "any_comment" ? "Qualquer comentário" : "Menção no Story"}
                        </Badge>
                        <Badge variant="secondary" className="text-[10px]">{flow.steps.length} etapas</Badge>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Switch checked={flow.active} onCheckedChange={(checked) => toggleFlow(flow.id, checked)} />
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setExpandedFlow(expandedFlow === flow.id ? null : flow.id)}><Eye size={14} /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditingFlow({ ...flow })}><Pencil size={14} /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => duplicateFlow(flow)}><Copy size={14} /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => deleteFlow(flow.id)}><Trash2 size={14} /></Button>
                  </div>
                </div>

                {expandedFlow === flow.id && (
                  <div className="mt-4 pt-4 border-t space-y-2">
                    {flow.steps.map((step, idx) => {
                      const config = STEP_CONFIG[step.type];
                      const Icon = config.icon;
                      return (
                        <div key={step.id} className="flex items-start gap-3">
                          <div className="flex flex-col items-center">
                            <div className={`w-7 h-7 rounded-md ${config.bg} flex items-center justify-center`}>
                              <Icon size={13} className={config.color} />
                            </div>
                            {idx < flow.steps.length - 1 && <div className="w-px h-4 bg-border mt-1" />}
                          </div>
                          <div className="text-sm">
                            <span className="font-medium">{config.label}</span>
                            {step.type === "delay" ? (
                              <span className="text-muted-foreground ml-1">— {step.delay_seconds}s</span>
                            ) : (
                              <p className="text-muted-foreground text-xs mt-0.5 line-clamp-2">{step.message}</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
