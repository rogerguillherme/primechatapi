import { Handle, Position } from "@xyflow/react";
import { Bot, Trash2 } from "lucide-react";

interface AiAgentNodeData {
  agent_id?: string;
  agent_name?: string;
  ai_prompt?: string;
  ai_model?: string;
  max_interactions?: number;
  onDelete?: (id: string) => void;
  [key: string]: unknown;
}

export function AiAgentNode({ id, data }: { id: string; data: AiAgentNodeData }) {
  return (
    <div className="bg-background border border-border rounded-xl shadow-md min-w-[260px] max-w-[300px] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-purple-500/10 border-b border-border">
        <div className="w-5 h-5 rounded-full bg-purple-500 flex items-center justify-center">
          <Bot size={11} className="text-white" />
        </div>
        <span className="text-xs font-semibold text-foreground flex-1">Agente IA</span>
        <button
          onClick={() => data.onDelete?.(id)}
          className="text-muted-foreground hover:text-destructive transition-colors p-0.5"
        >
          <Trash2 size={12} />
        </button>
      </div>
      <div className="p-3 space-y-1">
        {data.agent_name ? (
          <p className="text-xs font-medium text-primary">{data.agent_name}</p>
        ) : (
          <p className="text-xs text-muted-foreground italic">Nenhum agente selecionado</p>
        )}
        {data.ai_prompt && (
          <p className="text-[11px] text-foreground leading-relaxed whitespace-pre-wrap line-clamp-2 mt-1">
            {data.ai_prompt}
          </p>
        )}
        {data.max_interactions && (
          <p className="text-[10px] text-muted-foreground">
            Máx. {data.max_interactions} interações
          </p>
        )}
      </div>
      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-purple-500 !border-2 !border-background" />
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-purple-500 !border-2 !border-background" />
    </div>
  );
}
