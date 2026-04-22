import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Plus, Zap, Clock, Trash2, Instagram, Send, MessageCircle,
  ArrowRight, Eye, Pencil, Copy, ChevronDown, ChevronUp, Sparkles, Loader2,
  Bot, Link2, MousePointerClick, X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AutomationTemplatesModal, type AutomationTemplate } from "./AutomationTemplatesModal";

type DmType = "text" | "buttons" | "link";
type ButtonAction = "url" | "reply";

interface ButtonItem {
  id: string;
  title: string;
  action?: ButtonAction;       // "url" abre link · "reply" envia DM automática
  url?: string;                 // usado quando action="url"
  reply_message?: string;       // usado quando action="reply"
}

interface FlowStep {
  id: string;
  type: "reply_comment" | "send_dm" | "delay";
  message: string;
  delay_seconds?: number;
  // Apenas para send_dm:
  dm_type?: DmType;
  buttons?: ButtonItem[];
  link_url?: string;
  link_title?: string;
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

  // Auto-scan (movido da aba Comentários)
  const [autoScan, setAutoScan] = useState(false);
  const [autoScanInterval, setAutoScanInterval] = useState<number>(60);
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState<{ at: Date; matched: number; scanned: number } | null>(null);
  const scanTimerRef = useRef<number | null>(null);

  const runAutoScan = useCallback(async () => {
    if (scanning) return;
    setScanning(true);
    try {
      const { data, error } = await supabase.functions.invoke("instagram-auto-reply-comments", {
        body: { max_posts: 10, max_comments_per_post: 25 },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setLastScan({ at: new Date(), matched: data?.matched ?? 0, scanned: data?.scanned ?? 0 });
      if ((data?.matched ?? 0) > 0) {
        toast.success(`Auto-resposta: ${data.matched} comentário(s) respondido(s)`);
      } else {
        toast.message("Auto-scan concluído", { description: `${data?.scanned ?? 0} comentários verificados, nenhum novo correspondeu` });
      }
    } catch (e) {
      toast.error((e as Error).message || "Falha no auto-scan");
    } finally {
      setScanning(false);
    }
  }, [scanning]);

  useEffect(() => {
    if (!autoScan) {
      if (scanTimerRef.current) {
        window.clearInterval(scanTimerRef.current);
        scanTimerRef.current = null;
      }
      return;
    }
    runAutoScan();
    scanTimerRef.current = window.setInterval(runAutoScan, autoScanInterval * 1000);
    return () => {
      if (scanTimerRef.current) {
        window.clearInterval(scanTimerRef.current);
        scanTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoScan, autoScanInterval]);

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
        dm_type: s.type === "send_dm" ? "text" : undefined,
        buttons: [],
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
          steps: (steps || []).map((s: any) => ({
            id: s.id,
            type: s.step_type as FlowStep["type"],
            message: s.message || "",
            delay_seconds: s.delay_seconds || 5,
            dm_type: (s.dm_type as DmType) || "text",
            buttons: Array.isArray(s.buttons) ? s.buttons : [],
            link_url: s.link_url || "",
            link_title: s.link_title || "",
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
        { id: crypto.randomUUID(), type: "send_dm", message: "", dm_type: "text", buttons: [] },
      ],
      active: true,
      created_at: new Date().toISOString(),
    });
  };

  const saveFlow = async () => {
    if (!editingFlow || !user) return;
    if (!editingFlow.name.trim()) { toast.error("Dê um nome ao fluxo"); return; }
    const hasEmptyStep = editingFlow.steps.some((s) => {
      if (s.type === "delay") return false;
      if (s.type === "send_dm" && s.dm_type === "link") {
        return !s.message.trim() || !s.link_url?.trim();
      }
      if (s.type === "send_dm" && s.dm_type === "buttons") {
        if (!s.message.trim()) return true;
        if (!s.buttons || s.buttons.length === 0) return true;
        return s.buttons.some((b) => {
          if (!b.title.trim()) return true;
          const action = b.action || "url";
          if (action === "url") return !b.url?.trim();
          if (action === "reply") return !b.reply_message?.trim();
          return false;
        });
      }
      return !s.message.trim();
    });
    if (hasEmptyStep) { toast.error("Preencha todas as mensagens, títulos, URLs ou respostas dos botões"); return; }

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

      if (editingFlow.steps.length > 0) {
        await supabase.from("instagram_automation_steps").insert(
          editingFlow.steps.map((s, idx) => ({
            automation_id: editingFlow.id,
            step_order: idx,
            step_type: s.type,
            message: s.message,
            delay_seconds: s.delay_seconds || 5,
            dm_type: s.type === "send_dm" ? (s.dm_type || "text") : "text",
            buttons: (s.type === "send_dm" && s.dm_type === "buttons" ? (s.buttons || []) : []) as any,
            link_url: s.type === "send_dm" && s.dm_type === "link" ? (s.link_url || null) : null,
            link_title: s.type === "send_dm" && s.dm_type === "link" ? (s.link_title || null) : null,
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
          dm_type: s.type === "send_dm" ? (s.dm_type || "text") : "text",
          buttons: (s.type === "send_dm" && s.dm_type === "buttons" ? (s.buttons || []) : []) as any,
          link_url: s.type === "send_dm" && s.dm_type === "link" ? (s.link_url || null) : null,
          link_title: s.type === "send_dm" && s.dm_type === "link" ? (s.link_title || null) : null,
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
        ...(type === "send_dm" ? { dm_type: "text", buttons: [] } : {}),
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
                    ) : step.type === "reply_comment" ? (
                      <ReplyEditor step={step} onUpdate={(d) => updateStep(step.id, d)} />
                    ) : (
                      <DmEditor step={step} onUpdate={(d) => updateStep(step.id, d)} />
                    )}
                  </CardContent>
                </Card>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-2 pt-2 flex-wrap">
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

      {/* Auto-resposta de comentários sem resposta */}
      <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-purple-500/5">
        <CardContent className="pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Bot size={18} className="text-primary" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="auto-scan" className="text-sm font-semibold cursor-pointer">
                    Auto-resposta periódica
                  </Label>
                  {autoScan && (
                    <Badge variant="secondary" className="gap-1 h-5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Ativo
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Verifica comentários sem resposta e dispara automações ativas automaticamente
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <Switch id="auto-scan" checked={autoScan} onCheckedChange={setAutoScan} />
              <Select value={String(autoScanInterval)} onValueChange={(v) => setAutoScanInterval(Number(v))}>
                <SelectTrigger className="h-8 w-32 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">A cada 30s</SelectItem>
                  <SelectItem value="60">A cada 1min</SelectItem>
                  <SelectItem value="120">A cada 2min</SelectItem>
                  <SelectItem value="300">A cada 5min</SelectItem>
                  <SelectItem value="600">A cada 10min</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={runAutoScan} disabled={scanning} className="gap-1.5 h-8">
                {scanning ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                Verificar agora
              </Button>
            </div>
          </div>
          {lastScan && (
            <p className="text-[11px] text-muted-foreground mt-3 pt-3 border-t">
              Última verificação às {lastScan.at.toLocaleTimeString("pt-BR")} —{" "}
              <span className="font-medium">{lastScan.scanned}</span> comentários verificados ·{" "}
              <span className="font-medium text-emerald-600">{lastScan.matched}</span> respondidos
            </p>
          )}
        </CardContent>
      </Card>

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
                          <div className="text-sm flex-1 min-w-0">
                            <span className="font-medium">{config.label}</span>
                            {step.type === "send_dm" && step.dm_type && step.dm_type !== "text" && (
                              <Badge variant="outline" className="ml-2 text-[10px] gap-1">
                                {step.dm_type === "buttons" ? <><MousePointerClick size={9} /> Botões</> : <><Link2 size={9} /> Link</>}
                              </Badge>
                            )}
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

// ============= Sub-editors =============

function ReplyEditor({ step, onUpdate }: { step: FlowStep; onUpdate: (d: Partial<FlowStep>) => void }) {
  return (
    <div className="space-y-2">
      <Label>Resposta(s) ao comentário</Label>
      <Textarea
        placeholder="Ex: Obrigado pelo comentário! 🙌&#10;&#10;💡 Para várias respostas (escolha aleatória), separe com |||&#10;Ex: Obrigado! ||| Adorei seu comentário ❤️ ||| Que legal! 🚀"
        value={step.message}
        onChange={(e) => onUpdate({ message: e.target.value })}
        rows={4}
      />
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          Variáveis: {"{{nome}}"} · {"{{comentario}}"} · Separe respostas com <code className="text-pink-500 font-mono">|||</code>
        </p>
        <Button type="button" variant="ghost" size="sm" className="h-6 text-[11px] gap-1"
          onClick={() => onUpdate({ message: (step.message || "") + (step.message ? " ||| " : "") })}>
          <Plus size={10} /> variante
        </Button>
      </div>
      {step.message && step.message.includes("|||") && (
        <div className="text-[11px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 rounded px-2 py-1">
          ✨ {step.message.split("|||").filter((s) => s.trim()).length} variantes detectadas
        </div>
      )}
    </div>
  );
}

function DmEditor({ step, onUpdate }: { step: FlowStep; onUpdate: (d: Partial<FlowStep>) => void }) {
  const dmType: DmType = step.dm_type || "text";
  const buttons: ButtonItem[] = step.buttons || [];

  const updateButton = (id: string, patch: Partial<ButtonItem>) => {
    onUpdate({ buttons: buttons.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
  };
  const addButton = () => {
    if (buttons.length >= 3) {
      toast.warning("Instagram permite no máximo 3 botões");
      return;
    }
    onUpdate({
      buttons: [
        ...buttons,
        { id: crypto.randomUUID(), title: "", action: "url", url: "", reply_message: "" },
      ],
    });
  };
  const removeButton = (id: string) => {
    onUpdate({ buttons: buttons.filter((b) => b.id !== id) });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label className="text-xs">Tipo de mensagem no Direct</Label>
        <RadioGroup
          value={dmType}
          onValueChange={(v) => onUpdate({ dm_type: v as DmType })}
          className="grid grid-cols-3 gap-2"
        >
          <DmTypeOption value="text" label="Texto simples" icon={MessageCircle} active={dmType === "text"} />
          <DmTypeOption value="buttons" label="Com botões" icon={MousePointerClick} active={dmType === "buttons"} />
          <DmTypeOption value="link" label="Com link (CTA)" icon={Link2} active={dmType === "link"} />
        </RadioGroup>
      </div>

      <div className="space-y-2">
        <Label>Mensagem no Direct</Label>
        <Textarea
          placeholder="Ex: Oi {{nome}}! Vi seu comentário 🎁&#10;&#10;💡 Para várias mensagens (escolha aleatória), separe com |||"
          value={step.message}
          onChange={(e) => onUpdate({ message: e.target.value })}
          rows={4}
        />
        <p className="text-[11px] text-muted-foreground">
          Variáveis: {"{{nome}}"} · {"{{comentario}}"} · Separe variantes com <code className="text-pink-500 font-mono">|||</code>
        </p>
      </div>

      {dmType === "buttons" && (
        <div className="space-y-3 p-3 rounded-lg border border-blue-500/20 bg-blue-500/5">
          <div className="flex items-center justify-between">
            <Label className="text-xs flex items-center gap-1.5">
              <MousePointerClick size={12} className="text-blue-500" />
              Botões ({buttons.length}/3) — escolha o que cada um faz
            </Label>
            <Button type="button" variant="ghost" size="sm" className="h-6 text-[11px] gap-1" onClick={addButton} disabled={buttons.length >= 3}>
              <Plus size={10} /> Adicionar botão
            </Button>
          </div>

          {buttons.length === 0 && (
            <p className="text-[11px] text-muted-foreground italic">Nenhum botão. Clique em "Adicionar botão".</p>
          )}

          {buttons.map((b, i) => {
            const action: ButtonAction = b.action || "url";
            return (
              <div key={b.id} className="space-y-2 p-2 rounded-md bg-background/60 border border-border/60">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] shrink-0">#{i + 1}</Badge>
                  <Input
                    placeholder="Título do botão (máx 20 caracteres)"
                    value={b.title}
                    onChange={(e) => updateButton(b.id, { title: e.target.value.slice(0, 20) })}
                    maxLength={20}
                    className="h-8 text-xs"
                  />
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive shrink-0" onClick={() => removeButton(b.id)}>
                    <X size={12} />
                  </Button>
                </div>

                <RadioGroup
                  value={action}
                  onValueChange={(v) => updateButton(b.id, { action: v as ButtonAction })}
                  className="grid grid-cols-2 gap-1.5"
                >
                  <Label
                    htmlFor={`btn-${b.id}-url`}
                    className={`flex items-center gap-1.5 text-[11px] px-2 py-1.5 rounded border cursor-pointer ${action === "url" ? "border-primary bg-primary/5" : "border-border"}`}
                  >
                    <RadioGroupItem value="url" id={`btn-${b.id}-url`} className="h-3 w-3" />
                    <Link2 size={10} /> Abrir link (URL)
                  </Label>
                  <Label
                    htmlFor={`btn-${b.id}-reply`}
                    className={`flex items-center gap-1.5 text-[11px] px-2 py-1.5 rounded border cursor-pointer ${action === "reply" ? "border-primary bg-primary/5" : "border-border"}`}
                  >
                    <RadioGroupItem value="reply" id={`btn-${b.id}-reply`} className="h-3 w-3" />
                    <MessageCircle size={10} /> Responder no DM
                  </Label>
                </RadioGroup>

                {action === "url" ? (
                  <Input
                    placeholder="https://exemplo.com/oferta"
                    value={b.url || ""}
                    onChange={(e) => updateButton(b.id, { url: e.target.value })}
                    type="url"
                    className="h-8 text-xs"
                  />
                ) : (
                  <Textarea
                    placeholder={`Ex: Show, ${"{{nome}}"}! Aqui está o material 🎁\n\nhttps://meusite.com`}
                    value={b.reply_message || ""}
                    onChange={(e) => updateButton(b.id, { reply_message: e.target.value })}
                    rows={2}
                    className="text-xs"
                  />
                )}
              </div>
            );
          })}

          <p className="text-[10px] text-muted-foreground">
            ℹ️ Botões só funcionam quando enviamos a DM via /messages (não em <code>private_replies</code> a comentários, que só aceita texto).
          </p>
        </div>
      )}

      {dmType === "link" && (
        <div className="space-y-2 p-3 rounded-lg border border-rose-500/20 bg-rose-500/5">
          <Label className="text-xs flex items-center gap-1.5">
            <Link2 size={12} className="text-rose-500" />
            Botão CTA com link
          </Label>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_2fr] gap-2">
            <Input
              placeholder="Texto do botão"
              value={step.link_title || ""}
              onChange={(e) => onUpdate({ link_title: e.target.value.slice(0, 20) })}
              maxLength={20}
              className="h-8 text-xs"
            />
            <Input
              placeholder="https://exemplo.com"
              value={step.link_url || ""}
              onChange={(e) => onUpdate({ link_url: e.target.value })}
              type="url"
              className="h-8 text-xs"
            />
          </div>
          <p className="text-[10px] text-muted-foreground">
            ℹ️ Em respostas a comentários, o link é enviado anexado ao texto da mensagem (private_replies não suporta botões).
          </p>
        </div>
      )}
    </div>
  );
}

function DmTypeOption({ value, label, icon: Icon, active }: { value: string; label: string; icon: any; active: boolean }) {
  return (
    <Label
      htmlFor={`dm-${value}`}
      className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-all ${
        active ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
      }`}
    >
      <RadioGroupItem value={value} id={`dm-${value}`} className="shrink-0" />
      <Icon size={14} className={active ? "text-primary" : "text-muted-foreground"} />
      <span className="text-xs font-medium">{label}</span>
    </Label>
  );
}
