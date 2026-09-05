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
        <p className="text-xs text-muted-foreground">Palavras que ativam:</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {(() => {
            const values = (data.trigger_value || "")
              .split(/[,\n;|]/)
              .map((v) => v.trim())
              .filter(Boolean);
            if (values.length === 0) {
              return <span className="text-sm text-foreground">Não definido</span>;
            }
            return values.map((v, i) => (
              <span
                key={i}
                className="text-[11px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-700 dark:text-violet-300 border border-violet-500/20"
              >
                {v}
              </span>
            ));
          })()}
        </div>
      </div>
      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-violet-500 !border-2 !border-background" />
      <Handle type="source" position={Position.Right} id="default" className="!w-3 !h-3 !bg-violet-500 !border-2 !border-background" />
    </div>
  );
}
