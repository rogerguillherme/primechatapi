import { Handle, Position } from "@xyflow/react";
import { Clock, Trash2 } from "lucide-react";

interface DelayNodeData {
  delay_minutes?: number;
  onDelete?: (id: string) => void;
  [key: string]: unknown;
}

function formatDelay(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

export function DelayNode({ id, data }: { id: string; data: DelayNodeData }) {
  const minutes = data.delay_minutes || 60;
  return (
    <div className="bg-background border border-border rounded-xl shadow-md min-w-[200px] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border-b border-border">
        <div className="w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center">
          <Clock size={11} className="text-white" />
        </div>
        <span className="text-xs font-semibold text-foreground flex-1">Aguardar</span>
        <button
          onClick={() => data.onDelete?.(id)}
          className="text-muted-foreground hover:text-destructive transition-colors p-0.5"
        >
          <Trash2 size={12} />
        </button>
      </div>
      <div className="p-3 flex items-center justify-center">
        <span className="text-sm font-medium text-amber-600">{formatDelay(minutes)}</span>
      </div>
      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-amber-500 !border-2 !border-background" />
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-amber-500 !border-2 !border-background" />
    </div>
  );
}
