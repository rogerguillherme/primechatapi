import { Handle, Position } from "@xyflow/react";
import { GitBranch, Trash2 } from "lucide-react";

interface ConditionNodeData {
  trigger_value?: string;
  onDelete?: (id: string) => void;
  [key: string]: unknown;
}

export function ConditionNode({ id, data }: { id: string; data: ConditionNodeData }) {
  return (
    <div className="bg-background border border-border rounded-xl shadow-md min-w-[220px] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-violet-500/10 border-b border-border">
        <div className="w-5 h-5 rounded-full bg-violet-500 flex items-center justify-center">
          <GitBranch size={11} className="text-white" />
        </div>
        <span className="text-xs font-semibold text-foreground flex-1">Condição</span>
        <button
          onClick={() => data.onDelete?.(id)}
          className="text-muted-foreground hover:text-destructive transition-colors p-0.5"
        >
          <Trash2 size={12} />
        </button>
      </div>
      <div className="p-3">
        <p className="text-xs text-muted-foreground">Botão clicado:</p>
        <p className="text-sm font-medium text-foreground mt-0.5">
          {data.trigger_value || "Não definido"}
        </p>
      </div>
      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-violet-500 !border-2 !border-background" />
      <Handle type="source" position={Position.Right} id="default" className="!w-3 !h-3 !bg-violet-500 !border-2 !border-background" />
    </div>
  );
}
