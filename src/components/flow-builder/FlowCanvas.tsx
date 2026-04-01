import { useState, useCallback, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  type Node,
  type Edge,
  type Connection,
  type NodeTypes,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { TriggerNode } from "./nodes/TriggerNode";
import { MessageNode } from "./nodes/MessageNode";
import { DelayNode } from "./nodes/DelayNode";
import { ConditionNode } from "./nodes/ConditionNode";
import { InteractiveButtonsNode } from "./nodes/InteractiveButtonsNode";
import { CtaUrlNode } from "./nodes/CtaUrlNode";
import { NoResponseNode } from "./nodes/NoResponseNode";
import { NodeEditPanel } from "./NodeEditPanel";
import { Button } from "@/components/ui/button";
import {
  MessageSquare, Clock, GitBranch, MousePointerClick, ExternalLink, Plus, Braces, TimerOff,
} from "lucide-react";

const nodeTypes: NodeTypes = {
  trigger: TriggerNode,
  message: MessageNode,
  delay: DelayNode,
  condition: ConditionNode,
  interactive_buttons: InteractiveButtonsNode,
  cta_url: CtaUrlNode,
  no_response: NoResponseNode,
};

const defaultEdgeOptions = {
  animated: true,
  style: { stroke: "hsl(var(--primary))", strokeWidth: 2 },
  markerEnd: { type: MarkerType.ArrowClosed, color: "hsl(var(--primary))" },
};

interface FlowCanvasProps {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: (changes: any) => void;
  onEdgesChange: (changes: any) => void;
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
  templates: any[];
}

export function FlowCanvas({
  nodes, edges, onNodesChange, onEdgesChange, setNodes, setEdges, templates,
}: FlowCanvasProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge({ ...params, ...defaultEdgeOptions }, eds)),
    [setEdges]
  );

  const deleteNode = useCallback(
    (id: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== id));
      setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
      if (selectedNodeId === id) setSelectedNodeId(null);
    },
    [setNodes, setEdges, selectedNodeId]
  );

  const updateNodeData = useCallback(
    (id: string, data: Record<string, unknown>) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...data } } : n))
      );
    },
    [setNodes]
  );

  // Inject onDelete into all node data
  const nodesWithCallbacks = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        data: { ...n.data, onDelete: deleteNode },
      })),
    [nodes, deleteNode]
  );

  const addNode = useCallback(
    (type: string) => {
      const id = crypto.randomUUID();
      const lastNode = nodes.length > 0 ? nodes[nodes.length - 1] : null;
      const x = lastNode ? (lastNode.position?.x || 0) + 350 : 350;
      const y = lastNode ? lastNode.position?.y || 200 : 200;

      const defaultData: Record<string, unknown> = {};
      if (type === "message") {
        defaultData.custom_message = "";
        defaultData.template_id = null;
      } else if (type === "delay") {
        defaultData.delay_minutes = 60;
      } else if (type === "condition") {
        defaultData.trigger_value = "";
      } else if (type === "interactive_buttons") {
        defaultData.custom_message = "";
        defaultData.buttons = [{ id: crypto.randomUUID(), title: "" }];
      } else if (type === "cta_url") {
        defaultData.custom_message = "";
        defaultData.buttons = [{ id: crypto.randomUUID(), title: "Acessar site", url: "" }];
      } else if (type === "no_response") {
        defaultData.timeout_minutes = 10;
      }

      const newNode: Node = {
        id,
        type,
        position: { x, y },
        data: defaultData,
      };

      setNodes((nds) => [...nds, newNode]);

      // Auto-connect to last node
      if (lastNode) {
        const newEdge: Edge = {
          id: `e-${lastNode.id}-${id}`,
          source: lastNode.id,
          target: id,
          ...defaultEdgeOptions,
        };
        setEdges((eds) => [...eds, newEdge]);
      }
    },
    [nodes, setNodes, setEdges]
  );

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  return (
    <div className="relative w-full h-full">
      <ReactFlow
        nodes={nodesWithCallbacks}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        onNodeClick={(_, node) => setSelectedNodeId(node.id)}
        onPaneClick={() => setSelectedNodeId(null)}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        proOptions={{ hideAttribution: true }}
        className="bg-muted/30"
      >
        <Background gap={20} size={1} color="hsl(var(--border))" />
        <Controls
          showInteractive={false}
          className="!bg-background !border-border !shadow-md [&>button]:!bg-background [&>button]:!border-border [&>button]:!text-foreground [&>button:hover]:!bg-accent"
        />
        <MiniMap
          className="!bg-background !border-border"
          nodeColor="hsl(var(--primary))"
          maskColor="hsl(var(--muted) / 0.7)"
        />
      </ReactFlow>

      {/* Add node toolbar */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-background/95 backdrop-blur-sm border border-border rounded-xl px-3 py-2 shadow-lg">
        <span className="text-xs text-muted-foreground font-medium mr-1">Adicionar:</span>
        <Button variant="outline" size="sm" onClick={() => addNode("message")} className="gap-1.5 text-xs h-8">
          <MessageSquare size={12} /> Mensagem
        </Button>
        <Button variant="outline" size="sm" onClick={() => addNode("delay")} className="gap-1.5 text-xs h-8">
          <Clock size={12} /> Delay
        </Button>
        <Button variant="outline" size="sm" onClick={() => addNode("condition")} className="gap-1.5 text-xs h-8">
          <GitBranch size={12} /> Condição
        </Button>
        <Button variant="outline" size="sm" onClick={() => addNode("interactive_buttons")} className="gap-1.5 text-xs h-8">
          <MousePointerClick size={12} /> Botões
        </Button>
        <Button variant="outline" size="sm" onClick={() => addNode("cta_url")} className="gap-1.5 text-xs h-8">
          <ExternalLink size={12} /> Link
        </Button>
        <Button variant="outline" size="sm" onClick={() => addNode("no_response")} className="gap-1.5 text-xs h-8">
          <TimerOff size={12} /> Sem Resposta
        </Button>
        <Button variant="outline" size="sm" onClick={() => {/* TODO: open variables panel */}} className="gap-1.5 text-xs h-8">
          <Braces size={12} /> Variáveis
        </Button>
      </div>

      {/* Node edit panel */}
      {selectedNode && (
        <NodeEditPanel
          node={selectedNode}
          templates={templates}
          onUpdate={(data) => updateNodeData(selectedNode.id, data)}
          onClose={() => setSelectedNodeId(null)}
        />
      )}
    </div>
  );
}
