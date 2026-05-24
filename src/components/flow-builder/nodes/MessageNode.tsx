import { Handle, Position } from "@xyflow/react";
import { MessageSquare, Trash2, Image as ImageIcon, FileText, Video as VideoIcon } from "lucide-react";

interface MessageNodeData {
  label?: string;
  custom_message?: string;
  template_id?: string | null;
  media_url?: string | null;
  media_type?: string | null;
  onDelete?: (id: string) => void;
  [key: string]: unknown;
}

export function MessageNode({ id, data }: { id: string; data: MessageNodeData }) {
  const hasImage = data.media_url && data.media_type === "image";
  const hasDocument = data.media_url && data.media_type === "document";
  const hasVideo = data.media_url && data.media_type === "video";
  return (
    <div className="bg-background border border-border rounded-xl shadow-md min-w-[260px] max-w-[300px] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-emerald-500/10 border-b border-border">
        <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center">
          <MessageSquare size={11} className="text-white" />
        </div>
        <span className="text-xs font-semibold text-foreground flex-1">Enviar Mensagem</span>
        {hasImage && <ImageIcon size={11} className="text-emerald-600" />}
        {hasDocument && <FileText size={11} className="text-emerald-600" />}
        {hasVideo && <VideoIcon size={11} className="text-emerald-600" />}
        <button
          onClick={() => data.onDelete?.(id)}
          className="text-muted-foreground hover:text-destructive transition-colors p-0.5"
        >
          <Trash2 size={12} />
        </button>
      </div>
      {hasImage && (
        <div className="bg-muted/40 border-b border-border">
          <img
            src={data.media_url as string}
            alt="Mídia do passo"
            className="w-full max-h-32 object-cover"
          />
        </div>
      )}
      {hasDocument && (
        <div className="bg-muted/40 border-b border-border px-3 py-2 flex items-center gap-2">
          <FileText size={14} className="text-emerald-600" />
          <span className="text-[11px] text-muted-foreground truncate">
            PDF anexado
          </span>
        </div>
      )}
      <div className="p-3">
        <p className="text-xs text-foreground leading-relaxed whitespace-pre-wrap line-clamp-4">
          {data.custom_message || (hasImage || hasDocument ? "(somente arquivo)" : "Clique para editar a mensagem...")}
        </p>
      </div>
      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-background" />
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-background" />
    </div>
  );
}
