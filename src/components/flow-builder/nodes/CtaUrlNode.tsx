import { Handle, Position } from "@xyflow/react";
import { ExternalLink, Trash2 } from "lucide-react";

interface CtaUrlNodeData {
  custom_message?: string;
  buttons?: { id: string; title: string; url?: string }[];
  onDelete?: (id: string) => void;
  [key: string]: unknown;
}

export function CtaUrlNode({ id, data }: { id: string; data: CtaUrlNodeData }) {
  const btn = data.buttons?.[0];
  return (
    <div className="bg-background border border-border rounded-xl shadow-md min-w-[260px] max-w-[300px] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-rose-500/10 border-b border-border">
        <div className="w-5 h-5 rounded-full bg-rose-500 flex items-center justify-center">
          <ExternalLink size={11} className="text-white" />
        </div>
        <span className="text-xs font-semibold text-foreground flex-1">Botão com Link</span>
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
        <div className="flex items-center gap-1.5 text-xs py-1.5 px-3 rounded-md bg-rose-500/10 text-rose-700 dark:text-rose-300 font-medium border border-rose-500/20 justify-center">
          <ExternalLink size={11} />
          {btn?.title || "Acessar site"}
        </div>
        {btn?.url && (
          <p className="text-[10px] text-muted-foreground truncate">{btn.url}</p>
        )}
      </div>
      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-rose-500 !border-2 !border-background" />
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-rose-500 !border-2 !border-background" />
    </div>
  );
}
