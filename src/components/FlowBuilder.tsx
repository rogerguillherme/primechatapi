import { useState, useCallback, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNodesState, useEdgesState, type Node, type Edge, MarkerType } from "@xyflow/react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useUserTemplates } from "@/hooks/use-user-templates";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Plus, Trash2, GitBranch, ChevronRight, Play, Pause, ArrowLeft, Save,
  Sparkles, Send, Loader2, Bot, X, MessageCircle, Code2, Settings2,
} from "lucide-react";
import { FlowCanvas } from "@/components/flow-builder/FlowCanvas";
import { FlowSettingsDrawer, DEFAULT_FLOW_SETTINGS, type FlowSettings } from "@/components/flow-builder/FlowSettingsDrawer";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

interface Flow {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  created_at: string;
  trigger_type?: string | null;
  flow_kind?: "api" | "whatsapp";
}

type FlowKind = "api" | "whatsapp";

const defaultEdgeOptions = {
  animated: true,
  style: { stroke: "hsl(var(--primary))", strokeWidth: 2 },
  markerEnd: { type: MarkerType.ArrowClosed, color: "hsl(var(--primary))" },
};

const FLOW_DRAFT_STORAGE_PREFIX = "flow-editor-draft:";

type FlowDraftPayload = {
  version: 1;
  name: string;
  description: string;
  nodes: Node[];
  edges: Edge[];
  savedAt: string;
};

const createTriggerNode = (): Node => ({
  id: "trigger",
  type: "trigger",
  position: { x: 0, y: 200 },
  data: {},
  draggable: true,
});

const isFlowDraftPayload = (value: unknown): value is FlowDraftPayload => {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<FlowDraftPayload>;
  return (
    payload.version === 1 &&
    typeof payload.name === "string" &&
    typeof payload.description === "string" &&
    Array.isArray(payload.nodes) &&
    Array.isArray(payload.edges)
  );
};

const readFlowDraft = (storageKey: string): FlowDraftPayload | null => {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isFlowDraftPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const writeFlowDraft = (storageKey: string, payload: FlowDraftPayload) => {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(payload));
  } catch {
    // ignore write errors (quota, private mode)
  }
};

const clearFlowDraft = (storageKey: string) => {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // ignore clear errors
  }
};

/* ── Flow List View ── */
function FlowListView({ onEdit }: { onEdit: (flow: Flow | null, kind?: FlowKind) => void }) {
  const queryClient = useQueryClient();
  const [activeKind, setActiveKind] = useState<FlowKind>("api");

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

  const filteredFlows = (flows || []).filter((f) => ((f.flow_kind as FlowKind) || "api") === activeKind);

  const renderList = () => {
    if (isLoading) {
      return <p className="text-sm text-muted-foreground text-center py-8">Carregando...</p>;
    }
    if (!filteredFlows.length) {
      return (
        <p className="text-sm text-muted-foreground text-center py-8">
          {activeKind === "api"
            ? "Nenhum fluxo de API (Meta Cloud) criado ainda."
            : "Nenhum fluxo de WhatsApp (360Messenger) criado ainda."}
        </p>
      );
    }
    return (
      <div className="divide-y divide-border">
        {filteredFlows.map((flow) => (
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
                variant="ghost" size="icon" className="h-8 w-8"
                onClick={() => toggleActive.mutate({ id: flow.id, active: !flow.active })}
                title={flow.active ? "Desativar" : "Ativar"}
              >
                {flow.active ? <Pause size={14} /> : <Play size={14} />}
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(flow)}>
                <ChevronRight size={14} />
              </Button>
              <Button
                variant="ghost" size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive"
                onClick={() => { if (confirm("Remover fluxo?")) deleteFlow.mutate(flow.id); }}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <GitBranch size={18} />
            Fluxos de Automação
          </CardTitle>
          <CardDescription>
            {activeKind === "api"
              ? "Fluxos para contas conectadas via Meta Cloud API."
              : "Fluxos para contas conectadas via 360Messenger (360dialog)."}
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => onEdit(null, activeKind)}>
          <Plus size={14} /> Novo Fluxo
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <Tabs value={activeKind} onValueChange={(v) => setActiveKind(v as FlowKind)}>
          <div className="px-4 pb-3">
            <TabsList className="grid w-full max-w-md grid-cols-2">
              <TabsTrigger value="api" className="gap-2">
                <Code2 size={14} /> Fluxo API
              </TabsTrigger>
              <TabsTrigger value="whatsapp" className="gap-2">
                <MessageCircle size={14} /> Fluxo WhatsApp
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="api" className="m-0">
            {renderList()}
          </TabsContent>
          <TabsContent value="whatsapp" className="m-0">
            {renderList()}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

/* ── AI Flow Chat Panel ── */
function AiFlowChat({ onGenerate }: { onGenerate: (steps: any[]) => void }) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [messages, setMessages] = useState<{ role: "user" | "ai"; content: string }[]>([
    { role: "ai", content: "Descreva o fluxo de automação que deseja criar e eu vou gerar para você! Ex: 'Fluxo de boas-vindas com mensagem, delay de 1 hora e botões de sim/não'" },
  ]);

  const handleSend = async () => {
    if (!prompt.trim() || isGenerating) return;
    const userMsg = prompt.trim();
    setPrompt("");
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setIsGenerating(true);

    try {
      const { data, error } = await supabase.functions.invoke("generate-flow", {
        body: { description: userMsg },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const steps = data.steps || [];
      const summary = steps.map((s: any, i: number) => {
        const typeNames: Record<string, string> = {
          message: "📝 Mensagem",
          delay: "⏰ Delay",
          condition: "🔀 Condição",
          interactive_buttons: "🔘 Botões",
          cta_url: "🔗 Link",
          no_response: "⏱️ Sem Resposta",
          ai_agent: "🤖 Agente IA",
        };
        return `${i + 1}. ${typeNames[s.type] || s.type}`;
      }).join("\n");

      setMessages((prev) => [
        ...prev,
        { role: "ai", content: `Fluxo gerado com ${steps.length} passos:\n\n${summary}\n\nOs nós foram adicionados ao canvas!` },
      ]);

      onGenerate(steps);
    } catch (e: any) {
      setMessages((prev) => [
        ...prev,
        { role: "ai", content: `Erro: ${e.message}` },
      ]);
      toast.error(e.message);
    } finally {
      setIsGenerating(false);
    }
  };

  if (!open) {
    return (
      <Button
        onClick={() => setOpen(true)}
        className="absolute top-4 right-4 z-10 gap-2 shadow-lg"
        size="sm"
      >
        <Sparkles size={14} /> IA Flow Builder
      </Button>
    );
  }

  return (
    <div className="absolute top-4 right-4 z-10 w-80 bg-background border border-border rounded-xl shadow-elevated flex flex-col max-h-[calc(100%-2rem)]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <Bot size={16} className="text-primary" />
          <span className="text-sm font-medium">IA Flow Builder</span>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(false)}>
          <X size={14} />
        </Button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-[200px] max-h-[400px]">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`text-xs leading-relaxed px-3 py-2 rounded-lg whitespace-pre-wrap ${
              msg.role === "ai"
                ? "bg-muted text-foreground"
                : "bg-primary text-primary-foreground ml-6"
            }`}
          >
            {msg.content}
          </div>
        ))}
        {isGenerating && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground px-3 py-2 bg-muted rounded-lg">
            <Loader2 size={12} className="animate-spin" /> Gerando fluxo...
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-2 border-t border-border">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex gap-2"
        >
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Descreva seu fluxo..."
            className="text-xs min-h-[36px] max-h-[80px] resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <Button type="submit" size="icon" className="h-9 w-9 shrink-0" disabled={isGenerating || !prompt.trim()}>
            <Send size={14} />
          </Button>
        </form>
      </div>
    </div>
  );
}

/* ── Flow Editor View (Visual Canvas) ── */
function FlowEditorView({ flow, onBack, initialTriggerType, initialKind }: { flow: Flow | null; onBack: () => void; initialTriggerType?: string; initialKind?: FlowKind }) {
  const queryClient = useQueryClient();
  const draftKey = useMemo(() => `${FLOW_DRAFT_STORAGE_PREFIX}${flow?.id ?? "new"}`, [flow?.id]);
  const initialDraft = useMemo(() => readFlowDraft(draftKey), [draftKey]);

  const [name, setName] = useState(initialDraft?.name ?? flow?.name ?? "");
  const [description, setDescription] = useState(initialDraft?.description ?? flow?.description ?? "");
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(initialDraft?.nodes ?? []);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialDraft?.edges ?? []);
  const [isLoaded, setIsLoaded] = useState(Boolean(initialDraft) || !flow);
  const [hydratedFromDraft, setHydratedFromDraft] = useState(Boolean(initialDraft));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<FlowSettings>(DEFAULT_FLOW_SETTINGS);

  const flowKind: FlowKind = (flow?.flow_kind as FlowKind) || initialKind || "api";
  const isWhatsAppFlow = flowKind === "whatsapp";

  const { templates } = useUserTemplates();

  // Load existing steps and convert to nodes/edges
  useQuery({
    queryKey: ["flow-steps", flow?.id],
    queryFn: async () => {
      if (!flow) return [];
      const { data } = await supabase
        .from("flow_steps")
        .select("*")
        .eq("flow_id", flow.id)
        .order("step_order");

      const steps = data || [];
      const triggerNode = { ...createTriggerNode(), data: { trigger_type: flow.trigger_type || "" } };

      // Build nodes
      const stepNodes: Node[] = steps.map((s: any, i: number) => {
        // Calculate position: branch children go below their parent
        const parentIdx = s.parent_step_id ? steps.findIndex((p: any) => p.id === s.parent_step_id) : -1;
        const siblings = s.parent_step_id ? steps.filter((p: any) => p.parent_step_id === s.parent_step_id) : [];
        const siblingIdx = siblings.findIndex((p: any) => p.id === s.id);
        const yOffset = siblings.length > 1 ? (siblingIdx - (siblings.length - 1) / 2) * 180 : 0;
        const xBase = parentIdx >= 0 ? 350 + (parentIdx + 1) * 350 : 350 + i * 350;
        const yBase = parentIdx >= 0 ? 200 + yOffset : 200;

        return {
          id: s.id,
          type: s.step_type,
          position: { x: xBase, y: yBase },
          data: {
            template_id: s.template_id,
            custom_message: s.custom_message,
            delay_minutes: s.delay_minutes || 0,
            trigger_value: s.trigger_value,
            buttons: Array.isArray(s.buttons) ? s.buttons : [],
            timeout_minutes: s.timeout_minutes || null,
            agent_id: s.ai_agent_id || null,
            ai_prompt: s.ai_prompt || "",
            max_interactions: s.max_interactions || 5,
            message_variations: Array.isArray(s.message_variations) ? s.message_variations : [],
            delay_min_seconds: s.delay_min_seconds ?? null,
            delay_max_seconds: s.delay_max_seconds ?? null,
            media_url: s.media_url ?? null,
            media_type: s.media_type ?? null,
            file_name: s.file_name ?? null,
            // For blacklist: reason is stored in custom_message
            ...(s.step_type === "blacklist" ? { reason: s.custom_message || "opt-out via fluxo" } : {}),
          },
        };
      });

      const allNodes = [triggerNode, ...stepNodes];
      const allEdges: Edge[] = [];

      // Build edges from parent_step_id relationships
      const rootSteps = steps.filter((s: any) => !s.parent_step_id);
      if (rootSteps.length > 0) {
        // Connect trigger to the first root step
        allEdges.push({
          id: `e-trigger-${rootSteps[0].id}`,
          source: "trigger",
          target: rootSteps[0].id,
          ...defaultEdgeOptions,
        });
      }

      // Connect steps based on parent_step_id
      for (const step of steps) {
        if (step.parent_step_id) {
          const parentStep = steps.find((s: any) => s.id === step.parent_step_id);
          // Determine sourceHandle for interactive_buttons parents
          let sourceHandle: string | undefined;
          let edgeLabel: string | undefined;
          if (parentStep?.step_type === "interactive_buttons" && step.trigger_value) {
            const parentButtons = Array.isArray(parentStep.buttons) ? parentStep.buttons : [];
            const btnIdx = parentButtons.findIndex((b: any) => b.title === step.trigger_value);
            if (btnIdx >= 0) {
              sourceHandle = `btn-${btnIdx}`;
            }
            edgeLabel = step.trigger_value;
          }
          allEdges.push({
            id: `e-${step.parent_step_id}-${step.id}`,
            source: step.parent_step_id,
            target: step.id,
            sourceHandle,
            label: edgeLabel,
            ...defaultEdgeOptions,
          });
        }
      }

      // For root steps without parent, connect linearly (backwards compat)
      for (let i = 0; i < rootSteps.length - 1; i++) {
        const existing = allEdges.find(
          (e) => e.source === rootSteps[i].id && e.target === rootSteps[i + 1].id
        );
        if (!existing) {
          allEdges.push({
            id: `e-${rootSteps[i].id}-${rootSteps[i + 1].id}`,
            source: rootSteps[i].id,
            target: rootSteps[i + 1].id,
            ...defaultEdgeOptions,
          });
        }
      }

      setNodes(allNodes);
      setEdges(allEdges);
      setIsLoaded(true);
      return steps;
    },
    enabled: !!flow && !hydratedFromDraft,
  });

  useEffect(() => {
    if (initialDraft) {
      setName(initialDraft.name);
      setDescription(initialDraft.description);
      setNodes(initialDraft.nodes);
      setEdges(initialDraft.edges);
      setHydratedFromDraft(true);
      setIsLoaded(true);
      return;
    }

    setHydratedFromDraft(false);

    if (!flow) {
      setName("");
      setDescription("");
      const trigger = createTriggerNode();
      if (initialTriggerType) {
        trigger.data = { ...trigger.data, trigger_type: initialTriggerType };
      }
      setNodes([trigger]);
      setEdges([]);
      setIsLoaded(true);
      return;
    }

    setName(flow.name);
    setDescription(flow.description || "");
    setIsLoaded(false);
  }, [initialDraft, flow, setNodes, setEdges]);

  // Carregar settings do fluxo (variação, delay, janela horária)
  useEffect(() => {
    if (!flow) {
      setSettings(DEFAULT_FLOW_SETTINGS);
      return;
    }
    const f = flow as any;
    setSettings({
      variation_enabled: !!f.variation_enabled,
      delay_min_seconds: f.delay_min_seconds ?? DEFAULT_FLOW_SETTINGS.delay_min_seconds,
      delay_max_seconds: f.delay_max_seconds ?? DEFAULT_FLOW_SETTINGS.delay_max_seconds,
      sending_window_enabled: !!f.sending_window_enabled,
      sending_window_start: f.sending_window_start ?? DEFAULT_FLOW_SETTINGS.sending_window_start,
      sending_window_end: f.sending_window_end ?? DEFAULT_FLOW_SETTINGS.sending_window_end,
      sending_window_timezone: f.sending_window_timezone ?? DEFAULT_FLOW_SETTINGS.sending_window_timezone,
    });
  }, [flow]);

  const handleAiGenerate = useCallback((steps: any[]) => {
    // Keep trigger, add AI-generated nodes
    const triggerNode = nodes.find((n) => n.id === "trigger") || createTriggerNode();

    const newNodes: Node[] = steps.map((s: any, i: number) => ({
      id: crypto.randomUUID(),
      type: s.type,
      position: { x: 350 + i * 350, y: 200 },
      data: s.data || {},
    }));

    const allNodes = [triggerNode, ...newNodes];
    const allEdges: Edge[] = [];

    if (newNodes.length > 0) {
      allEdges.push({
        id: `e-trigger-${newNodes[0].id}`,
        source: "trigger",
        target: newNodes[0].id,
        ...defaultEdgeOptions,
      });
    }
    for (let i = 0; i < newNodes.length - 1; i++) {
      allEdges.push({
        id: `e-${newNodes[i].id}-${newNodes[i + 1].id}`,
        source: newNodes[i].id,
        target: newNodes[i + 1].id,
        ...defaultEdgeOptions,
      });
    }

    setNodes(allNodes);
    setEdges(allEdges);
  }, [nodes, setNodes, setEdges]);

  useEffect(() => {
    if (!isLoaded) return;

    writeFlowDraft(draftKey, {
      version: 1,
      name,
      description,
      nodes,
      edges,
      savedAt: new Date().toISOString(),
    });
  }, [draftKey, name, description, nodes, edges, isLoaded]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Nome do fluxo é obrigatório.");

      const stepNodes = nodes.filter((n) => n.type !== "trigger");
      if (stepNodes.length === 0) {
        throw new Error("Adicione pelo menos 1 passo antes de salvar o fluxo.");
      }

      const isUuid = (value: string) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

      const persistedIdByNodeId = new Map<string, string>();
      stepNodes.forEach((n) => {
        const nodeId = String(n.id);
        persistedIdByNodeId.set(nodeId, isUuid(nodeId) ? nodeId : crypto.randomUUID());
      });

      // Build adjacency list from edges (source → [{target, sourceHandle}])
      const adjList = new Map<string, { target: string; sourceHandle?: string | null }[]>();
      edges.forEach((e) => {
        const list = adjList.get(e.source) || [];
        list.push({ target: e.target, sourceHandle: e.sourceHandle });
        adjList.set(e.source, list);
      });

      // BFS from trigger to assign order and parent relationships
      type StepEntry = {
        node: Node;
        parentNodeId: string | null;
        triggerValue: string | null;
        order: number;
      };
      const entries: StepEntry[] = [];
      const visited = new Set<string>();
      const queue: { nodeId: string; parentNodeId: string | null; sourceHandle?: string | null }[] = [];

      // Start from trigger's children
      const triggerChildren = adjList.get("trigger") || [];
      triggerChildren.forEach((c) => queue.push({ nodeId: c.target, parentNodeId: null, sourceHandle: null }));

      let order = 0;
      while (queue.length > 0) {
        const { nodeId, parentNodeId, sourceHandle } = queue.shift()!;
        if (visited.has(nodeId)) continue;
        visited.add(nodeId);

        const node = stepNodes.find((n) => n.id === nodeId);
        if (!node) continue;

        // Determine trigger_value: from sourceHandle (button index) or from node data
        let triggerValue = (node.data.trigger_value as string) || null;
        if (sourceHandle && parentNodeId) {
          // Find parent node to get button title
          const parentNode = stepNodes.find((n) => n.id === parentNodeId);
          if (parentNode?.type === "interactive_buttons" && sourceHandle.startsWith("btn-")) {
            const btnIdx = parseInt(sourceHandle.replace("btn-", ""));
            const buttons = (parentNode.data.buttons as any[]) || [];
            if (buttons[btnIdx]) {
              triggerValue = buttons[btnIdx].title || null;
            }
          }
        }

        entries.push({ node, parentNodeId, triggerValue, order: order++ });

        // Queue children
        const children = adjList.get(nodeId) || [];
        children.forEach((c) => queue.push({ nodeId: c.target, parentNodeId: nodeId, sourceHandle: c.sourceHandle }));
      }

      // Add unconnected nodes
      stepNodes.forEach((n) => {
        if (!visited.has(n.id)) {
          entries.push({ node: n, parentNodeId: null, triggerValue: (n.data.trigger_value as string) || null, order: order++ });
        }
      });

      let flowId = flow?.id;

      // Extract trigger_type from the trigger node
      const triggerNode = nodes.find((n) => n.id === "trigger");
      const triggerType = (triggerNode?.data?.trigger_type as string) || null;

      const flowSettingsPayload = {
        variation_enabled: settings.variation_enabled,
        delay_min_seconds: settings.delay_min_seconds,
        delay_max_seconds: settings.delay_max_seconds,
        sending_window_enabled: settings.sending_window_enabled,
        sending_window_start: settings.sending_window_start,
        sending_window_end: settings.sending_window_end,
        sending_window_timezone: settings.sending_window_timezone,
      };

      if (flowId) {
        const { error } = await supabase.from("flows").update({ name, description: description || null, trigger_type: triggerType, ...flowSettingsPayload } as any).eq("id", flowId);
        if (error) throw error;
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Usuário não autenticado");
        const { data, error } = await supabase.from("flows").insert({ name, description: description || null, user_id: user.id, trigger_type: triggerType, flow_kind: (initialKind || "api"), ...flowSettingsPayload } as any).select("id").single();
        if (error) throw error;
        flowId = data.id;
      }

      const stepsToInsert = entries.map((e) => ({
        id: persistedIdByNodeId.get(String(e.node.id))!,
        flow_id: flowId!,
        step_order: e.order,
        step_type: e.node.type || "message",
        template_id: (e.node.data.template_id as string) || null,
        custom_message: e.node.type === "blacklist"
          ? ((e.node.data.reason as string) || "opt-out via fluxo")
          : ((e.node.data.custom_message as string) || null),
        delay_minutes: (e.node.data.delay_minutes as number) || 0,
        trigger_value: e.triggerValue,
        parent_step_id: e.parentNodeId ? persistedIdByNodeId.get(e.parentNodeId) || null : null,
        buttons: (e.node.type === "interactive_buttons" || e.node.type === "cta_url") ? (e.node.data.buttons as any) || [] : [],
        timeout_minutes: (e.node.data.timeout_minutes as number) || null,
        ai_agent_id: e.node.type === "ai_agent" ? (e.node.data.agent_id as string) || null : null,
        ai_prompt: e.node.type === "ai_agent" ? (e.node.data.ai_prompt as string) || null : null,
        max_interactions: e.node.type === "ai_agent" ? (e.node.data.max_interactions as number) || 5 : null,
        message_variations: e.node.type === "message" ? ((e.node.data.message_variations as string[]) || []).filter((s) => s && s.trim()) : [],
        delay_min_seconds: (e.node.data.delay_min_seconds as number | null) ?? null,
        delay_max_seconds: (e.node.data.delay_max_seconds as number | null) ?? null,
        media_url: e.node.type === "message" ? ((e.node.data.media_url as string) || null) : null,
        media_type: e.node.type === "message" ? ((e.node.data.media_type as string) || null) : null,
        file_name: e.node.type === "message" ? ((e.node.data.file_name as string) || null) : null,
      }));

      const { error: stepsError } = await supabase
        .from("flow_steps")
        .upsert(stepsToInsert, { onConflict: "id" });
      if (stepsError) throw stepsError;

      const persistedStepIds = stepsToInsert.map((s) => s.id);
      const { error: cleanupError } = await supabase
        .from("flow_steps")
        .delete()
        .eq("flow_id", flowId!)
        .not("id", "in", `(${persistedStepIds.join(",")})`);
      if (cleanupError) throw cleanupError;
    },
    onSuccess: () => {
      clearFlowDraft(draftKey);
      queryClient.invalidateQueries({ queryKey: ["flows"] });
      queryClient.invalidateQueries({ queryKey: ["flow-step-counts"] });
      toast.success("Fluxo salvo com sucesso!");
      onBack();
    },
    onError: (err: any) => toast.error(err.message),
  });

  if (!isLoaded) return <p className="text-sm text-muted-foreground text-center py-8">Carregando...</p>;

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-background shrink-0">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack}>
          <ArrowLeft size={16} />
        </Button>
        <h3 className="text-sm font-medium flex items-center gap-2">
          {flow ? "Editar Fluxo" : "Novo Fluxo"}
          {isWhatsAppFlow && (
            <Badge variant="outline" className="text-[10px] gap-1 font-normal">
              <MessageCircle size={10} /> WhatsApp 360
            </Badge>
          )}
        </h3>
        <div className="flex-1 flex items-center gap-3 ml-4">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do fluxo" className="h-8 max-w-[200px] text-sm" />
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descrição (opcional)" className="h-8 max-w-[200px] text-sm" />
        </div>
        {isWhatsAppFlow && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 size={14} />
            Configurações
            {(settings.variation_enabled || settings.sending_window_enabled) && (
              <span className="ml-1 h-1.5 w-1.5 rounded-full bg-primary" />
            )}
          </Button>
        )}
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} size="sm" className="gap-1.5">
          <Save size={14} />
          {saveMutation.isPending ? "Salvando..." : "Salvar"}
        </Button>
      </div>

      {/* Full-screen Canvas */}
      <div className="flex-1 relative">
        <FlowCanvas
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          setNodes={setNodes}
          setEdges={setEdges}
          templates={templates || []}
          variationEnabled={isWhatsAppFlow && settings.variation_enabled}
        />
        <AiFlowChat onGenerate={handleAiGenerate} />
      </div>

      <FlowSettingsDrawer
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        onChange={(patch) => setSettings((s) => ({ ...s, ...patch }))}
      />
    </div>
  );
}

/* ── Main FlowBuilder Component ── */
export function FlowBuilder({ initialTriggerType, initialFlowId }: { initialTriggerType?: string; initialFlowId?: string }) {
  const { user } = useAuth();
  const [editingFlow, setEditingFlow] = useState<Flow | null | undefined>(
    initialTriggerType ? null : undefined
  );
  const [newFlowKind, setNewFlowKind] = useState<FlowKind>("api");

  // Load flow by ID when initialFlowId is provided
  useEffect(() => {
    if (!initialFlowId || !user) return;
    const loadFlow = async () => {
      const { data } = await supabase
        .from("flows")
        .select("*")
        .eq("id", initialFlowId)
        .single();
      if (data) {
        setEditingFlow(data as Flow);
      }
    };
    loadFlow();
  }, [initialFlowId, user]);

  if (editingFlow !== undefined) {
    return (
      <FlowEditorView
        flow={editingFlow}
        onBack={() => setEditingFlow(undefined)}
        initialTriggerType={!editingFlow ? initialTriggerType : undefined}
        initialKind={!editingFlow ? newFlowKind : undefined}
      />
    );
  }

  return (
    <FlowListView
      onEdit={(flow, kind) => {
        if (!flow && kind) setNewFlowKind(kind);
        setEditingFlow(flow);
      }}
    />
  );
}
