import { useEffect, useRef, useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";
import {
  Plus,
  MessageSquare,
  Clock,
  GitBranch,
  MousePointerClick,
  ExternalLink,
  TimerOff,
  Bot,
  Ban,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export type InsertableStepType =
  | "message"
  | "delay"
  | "condition"
  | "interactive_buttons"
  | "cta_url"
  | "no_response"
  | "ai_agent"
  | "blacklist";

type InsertStepOption = {
  type: InsertableStepType;
  label: string;
  Icon: typeof MessageSquare;
};

type InsertStepEdgeData = {
  onInsert?: (edgeId: string, nodeType: InsertableStepType) => void;
};

const insertStepOptions: InsertStepOption[] = [
  { type: "message", label: "Mensagem", Icon: MessageSquare },
  { type: "delay", label: "Delay", Icon: Clock },
  { type: "condition", label: "Condição", Icon: GitBranch },
  { type: "interactive_buttons", label: "Botões", Icon: MousePointerClick },
  { type: "cta_url", label: "Link", Icon: ExternalLink },
  { type: "no_response", label: "Sem resposta", Icon: TimerOff },
  { type: "ai_agent", label: "Agente IA", Icon: Bot },
  { type: "blacklist", label: "Blacklist", Icon: Ban },
];

export function InsertStepEdge(props: EdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    markerEnd,
    style,
    data,
  } = props;

  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  useEffect(() => {
    if (!isOpen) return;

    const handleOutsideClick = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (menuRef.current && target && !menuRef.current.contains(target)) {
        setIsOpen(false);
      }
    };

    window.addEventListener("pointerdown", handleOutsideClick);
    return () => window.removeEventListener("pointerdown", handleOutsideClick);
  }, [isOpen]);

  const onInsert = (data as InsertStepEdgeData | undefined)?.onInsert;

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />

      <EdgeLabelRenderer>
        <div
          className="nodrag nopan"
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: "all",
            zIndex: 20,
          }}
        >
          <div ref={menuRef} className="relative">
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="h-7 w-7 rounded-full border border-border shadow-md"
              onClick={(event) => {
                event.stopPropagation();
                setIsOpen((prev) => !prev);
              }}
              title="Inserir passo"
            >
              <Plus size={14} />
            </Button>

            {isOpen && (
              <div className="absolute left-1/2 top-8 w-44 -translate-x-1/2 rounded-xl border border-border bg-background p-2 shadow-xl">
                <p className="px-2 pb-1 text-[11px] text-muted-foreground">Inserir passo:</p>
                <div className="space-y-1">
                  {insertStepOptions.map(({ type, label, Icon }) => (
                    <button
                      key={type}
                      type="button"
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-left text-foreground transition-colors hover:bg-accent"
                      onClick={(event) => {
                        event.stopPropagation();
                        onInsert?.(id, type);
                        setIsOpen(false);
                      }}
                    >
                      <Icon size={13} className="text-muted-foreground" />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}