import { Handle, Position } from "@xyflow/react";
import { MousePointerClick, Trash2 } from "lucide-react";

interface ButtonData {
  id: string;
  title: string;
}

interface InteractiveButtonsNodeData {
  custom_message?: string;
  buttons?: ButtonData[];
  onDelete?: (id: string) => void;
  [key: string]: unknown;
}

export function InteractiveButtonsNode({ id, data }: { id: string; data: InteractiveButtonsNodeData }) {
  const buttons = data.buttons || [];
  const nodeHeight = 80 + buttons.length * 36;

  return (
    <div className="bg-background border border-border rounded-xl shadow-md min-w-[260px] max-w-[300px] overflow-visible relative">
      <div className="flex items-center gap-2 px-3 py-2 bg-blue-500/10 border-b border-border">
        <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
          <MousePointerClick size={11} className="text-white" />
        </div>
        <span className="text-xs font-semibold text-foreground flex-1">Mensagem com Botões</span>
        <button
          onClick={() => data.onDelete?.(id)}
          className="text-muted-foreground hover:text-destructive transition-colors p-0.5"
        >
          <Trash2 size={12} />
        </button>
      </div>
      <div className="p-3 space-y-2">
        <p className="text-xs text-foreground leading-relaxed whitespace-pre-wrap line-clamp-3">
          {data.custom_message || "Mensagem..."}
        </p>
        <div className="space-y-1">
          {buttons.map((btn, idx) => (
            <div key={btn.id} className="relative">
              <div className="text-xs text-center py-1.5 px-3 rounded-md bg-blue-500/10 text-blue-700 dark:text-blue-300 font-medium border border-blue-500/20 pr-6">
                {btn.title || "Botão"}
              </div>
              <Handle
                type="source"
                position={Position.Right}
                id={`btn-${idx}`}
                className="!w-3 !h-3 !bg-blue-500 !border-2 !border-background"
                style={{ top: "50%", right: "-6px", position: "absolute" }}
              />
            </div>
          ))}
        </div>
      </div>
      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-blue-500 !border-2 !border-background" />
    </div>
  );
}
