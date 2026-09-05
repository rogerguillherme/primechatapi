import { Handle, Position } from "@xyflow/react";
import { Ban, Trash2 } from "lucide-react";

interface BlacklistNodeData {
  reason?: string;
  onDelete?: (id: string) => void;
  [key: string]: unknown;
}

export function BlacklistNode({ id, data }: { id: string; data: BlacklistNodeData }) {
  return (
    <div className="bg-background border border-destructive/40 rounded-xl shadow-md min-w-[240px] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-destructive/10 border-b border-destructive/20">
        <div className="w-5 h-5 rounded-full bg-destructive flex items-center justify-center">
          <Ban size={11} className="text-destructive-foreground" />
        </div>
        <span className="text-xs font-semibold text-foreground flex-1">Blacklist</span>
        <button
          onClick={() => data.onDelete?.(id)}
          className="text-muted-foreground hover:text-destructive transition-colors p-0.5"
        >
          <Trash2 size={12} />
        </button>
      </div>
      <div className="p-3">
        <p className="text-xs text-muted-foreground">Adiciona o lead à blacklist</p>
        <p className="text-[11px] text-foreground mt-1 font-medium truncate">
          Motivo: {data.reason || "opt-out via fluxo"}
        </p>
        <p className="text-[10px] text-muted-foreground mt-1">
          Será excluído de disparos futuros.
        </p>
      </div>
      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-destructive !border-2 !border-background" />
      <Handle type="source" position={Position.Right} id="default" className="!w-3 !h-3 !bg-destructive !border-2 !border-background" />
    </div>
  );
}
