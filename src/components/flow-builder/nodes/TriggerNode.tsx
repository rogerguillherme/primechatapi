import { Handle, Position } from "@xyflow/react";
import { Zap } from "lucide-react";

export function TriggerNode() {
  return (
    <div className="bg-background border-2 border-dashed border-primary/40 rounded-xl p-4 min-w-[220px] shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
          <Zap size={14} className="text-primary" />
        </div>
        <span className="text-sm font-semibold text-foreground">Quando...</span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        Um Trigger é o evento que inicia sua automação.
      </p>
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-primary !border-2 !border-background" />
    </div>
  );
}
