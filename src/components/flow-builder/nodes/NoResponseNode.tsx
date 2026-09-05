import { Handle, Position } from "@xyflow/react";
import { TimerOff, Trash2 } from "lucide-react";
import { useChatLabels } from "@/hooks/use-chat-labels";
import {
  noResponseConditionLabel,
  type NoResponseCondition,
} from "@/components/flow-builder/NodeEditPanel";

interface NoResponseNodeData {
  timeout_minutes?: number;
  /** Condições configuradas — cada uma vira uma saída própria do nó. */
  no_response_conditions?: NoResponseCondition[];
  onDelete?: (id: string) => void;
  [key: string]: unknown;
}

function formatTimeout(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

export function NoResponseNode({ id, data }: { id: string; data: NoResponseNodeData }) {
  const minutes = data.timeout_minutes || 10;
  const { labels } = useChatLabels();
  const conditions = (Array.isArray(data.no_response_conditions)
    ? data.no_response_conditions
    : []
  ).filter((c) => c && c.key);

  return (
    <div className="bg-background border border-border rounded-xl shadow-md min-w-[220px] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-rose-500/10 border-b border-border">
        <div className="w-5 h-5 rounded-full bg-rose-500 flex items-center justify-center">
          <TimerOff size={11} className="text-white" />
        </div>
        <span className="text-xs font-semibold text-foreground flex-1">Sem Resposta</span>
        <button
          onClick={() => data.onDelete?.(id)}
          className="text-muted-foreground hover:text-destructive transition-colors p-0.5"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {conditions.length === 0 ? (
        <div className="p-3 text-center">
          <p className="text-xs text-muted-foreground">Se não responder em:</p>
          <p className="text-sm font-medium text-rose-600 mt-0.5">{formatTimeout(minutes)}</p>
          <p className="text-[10px] text-muted-foreground mt-1">→ envia próxima mensagem</p>
        </div>
      ) : (
        <div className="py-2">
          {conditions.map((cond, idx) => {
            const labelName = labels.find((l) => l.id === cond.label_id)?.name;
            return (
              <div key={cond.key} className="relative px-3 py-1.5">
                <p className="text-[11px] text-foreground pr-2">
                  {noResponseConditionLabel(cond, labelName)}
                </p>
                <Handle
                  type="source"
                  position={Position.Right}
                  id={`cond-${cond.key}`}
                  style={{ top: "50%" }}
                  className="!w-3 !h-3 !bg-rose-500 !border-2 !border-background"
                />
                {idx < conditions.length - 1 && (
                  <div className="absolute left-3 right-3 bottom-0 h-px bg-border" />
                )}
              </div>
            );
          })}
        </div>
      )}

      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !bg-rose-500 !border-2 !border-background"
      />
      {conditions.length === 0 && (
        <Handle
          type="source"
          position={Position.Right}
          className="!w-3 !h-3 !bg-rose-500 !border-2 !border-background"
        />
      )}
    </div>
  );
}
