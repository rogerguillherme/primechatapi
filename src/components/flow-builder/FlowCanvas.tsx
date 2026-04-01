import { useState, useCallback, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  type Node,
  type Edge,
  type Connection,
  type NodeTypes,
  type EdgeTypes,
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
import { InsertStepEdge, type InsertableStepType } from "./InsertStepEdge";
import { Button } from "@/components/ui/button";
import {
  MessageSquare, Clock, GitBranch, MousePointerClick, ExternalLink, Braces, TimerOff,
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

const edgeTypes: EdgeTypes = {
  insertable: InsertStepEdge,
};

const defaultEdgeOptions = {
  type: "insertable",
  animated: true,
  style: { stroke: "hsl(var(--primary))", strokeWidth: 2 },
  markerEnd: { type: MarkerType.ArrowClosed, color: "hsl(var(--primary))" },
  deletable: true,
};

const createDefaultNodeData = (type: InsertableStepType): Record<string, unknown> => {
  if (type === "message") {
    return { custom_message: "", template_id: null };
  }
  if (type === "delay") {
    return { delay_minutes: 60 };
  }
  if (type === "condition") {
    return { trigger_value: "" };
  }
  if (type === "interactive_buttons") {
    return { custom_message: "", buttons: [{ id: crypto.randomUUID(), title: "" }] };
  }
  if (type === "cta_url") {
    return {
      custom_message: "",
      buttons: [{ id: crypto.randomUUID(), title: "Acessar site", url: "" }],
    };
  }

  return { timeout_minutes: 10 };
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
    (params: Connection) => {
      // Add label when connecting from a button handle
      let label: string | undefined;
      if (params.sourceHandle?.startsWith("btn-")) {
        const sourceNode = nodes.find((n) => n.id === params.source);
        if (sourceNode?.type === "interactive_buttons") {
          const btnIdx = parseInt(params.sourceHandle.replace("btn-", ""));
          const buttons = (sourceNode.data.buttons as any[]) || [];
          if (buttons[btnIdx]) {
            label = buttons[btnIdx].title || `Botão ${btnIdx + 1}`;
          }
        }
      }
      setEdges((eds) => addEdge({ ...params, ...defaultEdgeOptions, ...(label ? { label } : {}) }, eds));
    },
    [setEdges, nodes]
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
    (type: InsertableStepType) => {
      const id = crypto.randomUUID();
      const lastNode = nodes.length > 0 ? nodes[nodes.length - 1] : null;
      const x = lastNode ? (lastNode.position?.x || 0) + 350 : 350;
      const y = lastNode ? lastNode.position?.y || 200 : 200;

      const newNode: Node = {
        id,
        type,
        position: { x, y },
        data: createDefaultNodeData(type),
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

  const insertNodeOnEdge = useCallback(
    (edgeId: string, type: InsertableStepType) => {
      const edgeToSplit = edges.find((edge) => edge.id === edgeId);
      if (!edgeToSplit) return;

      const sourceNode = nodes.find((node) => node.id === edgeToSplit.source);
      const targetNode = nodes.find((node) => node.id === edgeToSplit.target);

      const sourceX = sourceNode?.position?.x ?? 0;
      const sourceY = sourceNode?.position?.y ?? 200;
      const targetX = targetNode?.position?.x ?? sourceX + 350;
      const targetY = targetNode?.position?.y ?? sourceY;

      const newNodeId = crypto.randomUUID();
      const newNode: Node = {
        id: newNodeId,
        type,
        position: {
          x: (sourceX + targetX) / 2,
          y: (sourceY + targetY) / 2,
        },
        data: createDefaultNodeData(type),
      };

      const baseEdgeStyle = edgeToSplit.style || defaultEdgeOptions.style;
      const baseMarkerEnd = edgeToSplit.markerEnd || defaultEdgeOptions.markerEnd;

      const firstEdge: Edge = {
        id: `e-${edgeToSplit.source}-${newNodeId}`,
        source: edgeToSplit.source,
        target: newNodeId,
        sourceHandle: edgeToSplit.sourceHandle,
        animated: edgeToSplit.animated ?? true,
        style: baseEdgeStyle,
        markerEnd: baseMarkerEnd,
        type: "insertable",
        deletable: true,
        ...(edgeToSplit.label ? { label: edgeToSplit.label } : {}),
      };

      const secondEdge: Edge = {
        id: `e-${newNodeId}-${edgeToSplit.target}`,
        source: newNodeId,
        target: edgeToSplit.target,
        targetHandle: edgeToSplit.targetHandle,
        animated: edgeToSplit.animated ?? true,
        style: baseEdgeStyle,
        markerEnd: baseMarkerEnd,
        type: "insertable",
        deletable: true,
      };

      setNodes((currentNodes) => [...currentNodes, newNode]);
      setEdges((currentEdges) => [
        ...currentEdges.filter((edge) => edge.id !== edgeId),
        firstEdge,
        secondEdge,
      ]);
      setSelectedNodeId(newNodeId);
    },
    [edges, nodes, setEdges, setNodes]
  );

  const edgesWithCallbacks = useMemo(
    () =>
      edges.map((edge) => ({
        ...edge,
        type: edge.type || "insertable",
        data: {
          ...(typeof edge.data === "object" && edge.data ? edge.data : {}),
          onInsert: (targetEdgeId: string, nodeType: InsertableStepType) =>
            insertNodeOnEdge(targetEdgeId, nodeType),
        },
      })),
    [edges, insertNodeOnEdge]
  );

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  return (
    <div className="relative w-full h-full">
      <ReactFlow
        nodes={nodesWithCallbacks}
        edges={edgesWithCallbacks}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        onNodeClick={(_, node) => setSelectedNodeId(node.id)}
        onPaneClick={() => setSelectedNodeId(null)}
        onEdgeClick={(_, edge) => {
          setEdges((eds) => eds.filter((e) => e.id !== edge.id));
        }}
        deleteKeyCode={["Backspace", "Delete"]}
        nodesDraggable
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
