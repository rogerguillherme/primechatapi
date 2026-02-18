import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNodesState, useEdgesState, type Node, type Edge, MarkerType } from "@xyflow/react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Plus, Trash2, GitBranch, ChevronRight, Play, Pause, ArrowLeft, Save,
} from "lucide-react";
import { FlowCanvas } from "@/components/flow-builder/FlowCanvas";

interface Flow {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  created_at: string;
}

const defaultEdgeOptions = {
  animated: true,
  style: { stroke: "hsl(var(--primary))", strokeWidth: 2 },
  markerEnd: { type: MarkerType.ArrowClosed, color: "hsl(var(--primary))" },
};

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
        )}
      </CardContent>
    </Card>
  );
}

/* ── Flow Editor View (Visual Canvas) ── */
function FlowEditorView({ flow, onBack }: { flow: Flow | null; onBack: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(flow?.name || "");
  const [description, setDescription] = useState(flow?.description || "");
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [isLoaded, setIsLoaded] = useState(!flow);

  const { data: templates } = useQuery({
    queryKey: ["flow-templates"],
    queryFn: async () => {
      const { data } = await supabase.from("chat_templates").select("*").order("name");
      return data || [];
    },
  });

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
      const triggerNode: Node = {
        id: "trigger",
        type: "trigger",
        position: { x: 0, y: 200 },
        data: {},
        draggable: true,
      };

      const stepNodes: Node[] = steps.map((s: any, i: number) => ({
        id: s.id,
        type: s.step_type,
        position: { x: 350 + i * 350, y: 200 },
        data: {
          template_id: s.template_id,
          custom_message: s.custom_message,
          delay_minutes: s.delay_minutes || 0,
          trigger_value: s.trigger_value,
          buttons: Array.isArray(s.buttons) ? s.buttons : [],
        },
      }));

      const allNodes = [triggerNode, ...stepNodes];
      const allEdges: Edge[] = [];

      // Connect trigger to first step
      if (stepNodes.length > 0) {
        allEdges.push({
          id: `e-trigger-${stepNodes[0].id}`,
          source: "trigger",
          target: stepNodes[0].id,
          ...defaultEdgeOptions,
        });
      }
      // Connect steps sequentially
      for (let i = 0; i < stepNodes.length - 1; i++) {
        allEdges.push({
          id: `e-${stepNodes[i].id}-${stepNodes[i + 1].id}`,
          source: stepNodes[i].id,
          target: stepNodes[i + 1].id,
          ...defaultEdgeOptions,
        });
      }

      setNodes(allNodes);
      setEdges(allEdges);
      setIsLoaded(true);
      return steps;
    },
    enabled: !!flow,
  });

  // Initialize with trigger node for new flows
  useState(() => {
    if (!flow) {
      setNodes([
        {
          id: "trigger",
          type: "trigger",
          position: { x: 0, y: 200 },
          data: {},
          draggable: true,
        },
      ]);
    }
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Nome do fluxo é obrigatório.");

      let flowId = flow?.id;

      if (flowId) {
        const { error } = await supabase.from("flows").update({ name, description: description || null }).eq("id", flowId);
        if (error) throw error;
        await supabase.from("flow_steps").delete().eq("flow_id", flowId);
      } else {
        const { data, error } = await supabase.from("flows").insert({ name, description: description || null }).select("id").single();
        if (error) throw error;
        flowId = data.id;
      }

      // Convert nodes (excluding trigger) to steps, ordered by edges
      const stepNodes = nodes.filter((n) => n.type !== "trigger");
      if (stepNodes.length > 0) {
        // Build order from edges
        const ordered: Node[] = [];
        const edgeMap = new Map<string, string>();
        edges.forEach((e) => edgeMap.set(e.source, e.target));

        // Find the first step (connected from trigger)
        let currentId = edgeMap.get("trigger");
        const visited = new Set<string>();
        while (currentId && !visited.has(currentId)) {
          visited.add(currentId);
          const node = stepNodes.find((n) => n.id === currentId);
          if (node) ordered.push(node);
          currentId = edgeMap.get(currentId);
        }
        // Add any unconnected nodes at the end
        stepNodes.forEach((n) => {
          if (!visited.has(n.id)) ordered.push(n);
        });

        const stepsToInsert = ordered.map((n, i) => ({
          flow_id: flowId!,
          step_order: i,
          step_type: n.type || "message",
          template_id: (n.data.template_id as string) || null,
          custom_message: (n.data.custom_message as string) || null,
          delay_minutes: (n.data.delay_minutes as number) || 0,
          trigger_value: (n.data.trigger_value as string) || null,
          parent_step_id: null,
          buttons: (n.type === "interactive_buttons" || n.type === "cta_url") ? (n.data.buttons as any) || [] : [],
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

  if (!isLoaded) return <p className="text-sm text-muted-foreground text-center py-8">Carregando...</p>;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack}>
          <ArrowLeft size={16} />
        </Button>
        <h3 className="text-base font-medium flex-1">{flow ? "Editar Fluxo" : "Novo Fluxo"}</h3>
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} size="sm" className="gap-1.5">
          <Save size={14} />
          {saveMutation.isPending ? "Salvando..." : "Salvar"}
        </Button>
      </div>

      {/* Name/Description */}
      <Card>
        <CardContent className="pt-4">
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

      {/* Visual Canvas */}
      <Card className="overflow-hidden">
        <div className="h-[500px]">
          <FlowCanvas
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            setNodes={setNodes}
            setEdges={setEdges}
            templates={templates || []}
          />
        </div>
      </Card>
    </div>
  );
}

/* ── Main FlowBuilder Component ── */
export function FlowBuilder() {
  const [editingFlow, setEditingFlow] = useState<Flow | null | undefined>(undefined);

  if (editingFlow !== undefined) {
    return <FlowEditorView flow={editingFlow} onBack={() => setEditingFlow(undefined)} />;
  }

  return <FlowListView onEdit={(flow) => setEditingFlow(flow)} />;
}
