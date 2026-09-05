import { Handle, Position } from "@xyflow/react";
import { Tag, Trash2 } from "lucide-react";
import { useChatLabels } from "@/hooks/use-chat-labels";

interface TagNodeData {
  label_ids?: string[];
  onDelete?: (id: string) => void;
  [key: string]: unknown;
}

export function TagNode({ id, data }: { id: string; data: TagNodeData }) {
  const { labels } = useChatLabels();
  const selected = (data.label_ids || [])
    .map((lid) => labels.find((l) => l.id === lid))
    .filter(Boolean);

  return (
    <div className="bg-background border border-border rounded-xl shadow-md min-w-[220px] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border-b border-border">
        <div className="w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center">
          <Tag size={11} className="text-white" />
        </div>
        <span className="text-xs font-semibold text-foreground flex-1">Etiqueta</span>
        <button
          onClick={() => data.onDelete?.(id)}
          className="text-muted-foreground hover:text-destructive transition-colors p-0.5"
        >
          <Trash2 size={12} />
        </button>
      </div>
      <div className="p-3">
        <p className="text-xs text-muted-foreground">Aplica ao lead:</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {selected.length === 0 ? (
            <span className="text-sm text-foreground">Nenhuma etiqueta</span>
          ) : (
            selected.map((l) => (
              <span
                key={l!.id}
                className="text-[11px] px-1.5 py-0.5 rounded border"
                style={{ borderColor: l!.color, color: l!.color }}
              >
                {l!.name}
              </span>
            ))
          )}
        </div>
      </div>
      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-amber-500 !border-2 !border-background" />
      <Handle type="source" position={Position.Right} id="default" className="!w-3 !h-3 !bg-amber-500 !border-2 !border-background" />
    </div>
  );
}
