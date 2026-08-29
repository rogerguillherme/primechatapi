import { useMemo, useRef, useState } from "react";
import { Loader2, Smile, Trash2, Upload } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Seletor de emojis e figurinhas do chat.
 *
 * - Aba "Emojis": insere o caractere no campo de mensagem (onSelect).
 * - Aba "Figurinhas": lista as figurinhas .webp salvas pelo usuário (enviadas
 *   como sticker real pela API da Meta) e permite subir novas. Abaixo ficam os
 *   emojis grandes, que o WhatsApp amplia quando enviados sozinhos.
 */
export interface StickerItem {
  id: string;
  url: string;
}

export interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  /** Envia um emoji como texto (aparece ampliado quando está sozinho). */
  onSendSticker: (emoji: string) => void;
  /** Figurinhas .webp salvas na biblioteca do usuário. */
  stickers?: StickerItem[];
  /** Envia uma figurinha .webp já salva. */
  onSendStickerImage?: (sticker: StickerItem) => void;
  /** Faz upload de um novo arquivo .webp para a biblioteca. */
  onUploadSticker?: (file: File) => void | Promise<void>;
  /** Remove uma figurinha da biblioteca. */
  onDeleteSticker?: (sticker: StickerItem) => void;
  uploading?: boolean;
  disabled?: boolean;
}

const CATEGORIES: { label: string; emojis: string[] }[] = [
  {
    label: "Sorrisos",
    emojis: [
      "😀","😃","😄","😁","😆","😅","🤣","😂","🙂","🙃","😉","😊","😇","🥰","😍","🤩",
      "😘","😗","😚","😙","🥲","😋","😛","😜","🤪","😝","🤑","🤗","🤭","🤫","🤔","🤐",
      "😐","😑","😶","😏","😒","🙄","😬","😮","😯","😴","🥱","😪","😵","🤯","🥳","😎",
      "🤓","🧐","😕","😟","🙁","☹️","😯","😢","😭","😤","😠","😡","🤬","😱","😨","😰",
    ],
  },
  {
    label: "Gestos",
    emojis: [
      "👍","👎","👌","🤌","✌️","🤞","🤟","🤘","👏","🙌","👐","🤲","🤝","🙏","💪","🫶",
      "👋","🤙","☝️","👆","👇","👉","👈","✍️","💅","🦾","🫡","🫰","🤳","👀","🧠","👣",
    ],
  },
  {
    label: "Coração",
    emojis: [
      "❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❣️","💕","💞","💓","💗","💖",
      "💘","💝","💟","♥️","💋","🫀","🌹","🥀","💐","🌸","🌺","🌻","🌼","🌷","✨","💫",
    ],
  },
  {
    label: "Objetos",
    emojis: [
      "🔥","💯","⭐","🌟","⚡","💥","💸","💰","🎁","🎉","🎊","🏆","🥇","📈","📉","📊",
      "📌","📎","📝","📅","⏰","⏳","🔔","📢","📣","💡","🔑","🔒","🚀","✅","❌","⚠️",
      "🛒","🛍️","💳","📱","💻","☎️","📞","✉️","📩","🔗","🎯","🧾","🩺","💊","🥗","🏋️",
    ],
  },
];

const STICKERS: string[] = [
  "👍", "🔥", "❤️", "😂", "😍", "🎉", "🙏", "👏",
  "💯", "🚀", "✅", "🤝", "😮", "😢", "🥳", "💪",
  "☕", "⏰", "💰", "🎯", "😅", "🤔", "👀", "✨",
];

export function EmojiPicker({
  onSelect,
  onSendSticker,
  stickers = [],
  onSendStickerImage,
  onUploadSticker,
  onDeleteSticker,
  uploading,
  disabled,
}: EmojiPickerProps) {
  const [open, setOpen] = useState(false);
  const stickerInputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"emoji" | "sticker">("emoji");
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    if (!query.trim()) return CATEGORIES;
    // Busca simples por categoria: sem base de nomes, filtrar por rótulo
    // já cobre o caso real de "quero os corações".
    const q = query.trim().toLowerCase();
    return CATEGORIES.filter((c) => c.label.toLowerCase().includes(q));
  }, [query]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title="Emojis e figurinhas"
          className="p-2 rounded-full hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          <Smile size={20} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-[22rem] p-0">
        <div className="flex items-center gap-1 p-2 border-b border-border">
          <button
            type="button"
            onClick={() => setTab("emoji")}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
              tab === "emoji" ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50",
            )}
          >
            Emojis
          </button>
          <button
            type="button"
            onClick={() => setTab("sticker")}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
              tab === "sticker" ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50",
            )}
          >
            Figurinhas
          </button>
        </div>

        {tab === "emoji" ? (
          <div className="p-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar categoria (sorrisos, gestos...)"
              className="h-8 text-xs mb-2"
            />
            <div className="max-h-64 overflow-y-auto overscroll-contain pr-1">
              {visible.map((cat) => (
                <div key={cat.label} className="mb-2">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground px-1 mb-1">
                    {cat.label}
                  </p>
                  <div className="grid grid-cols-8 gap-0.5">
                    {cat.emojis.map((e, i) => (
                      <button
                        key={`${cat.label}-${i}`}
                        type="button"
                        onClick={() => onSelect(e)}
                        className="h-8 w-8 flex items-center justify-center text-lg rounded hover:bg-accent"
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {visible.length === 0 && (
                <p className="text-xs text-muted-foreground px-1 py-3">Nenhuma categoria encontrada.</p>
              )}
            </div>
          </div>
        ) : (
          <div className="p-3">
            <input
              ref={stickerInputRef}
              type="file"
              accept="image/webp,.webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file && onUploadSticker) void onUploadSticker(file);
                if (e.target) e.target.value = "";
              }}
            />

            {onUploadSticker && (
              <button
                type="button"
                disabled={disabled || uploading}
                onClick={() => stickerInputRef.current?.click()}
                className="w-full mb-2 flex items-center justify-center gap-2 h-8 rounded-md border border-dashed border-border text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
              >
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {uploading ? "Enviando figurinha..." : "Subir figurinha (.webp)"}
              </button>
            )}

            {stickers.length > 0 && (
              <>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground px-1 mb-1">
                  Minhas figurinhas
                </p>
                <div className="grid grid-cols-4 gap-1 max-h-48 overflow-y-auto overscroll-contain mb-3">
                  {stickers.map((s) => (
                    <div key={s.id} className="relative group">
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                          onSendStickerImage?.(s);
                          setOpen(false);
                        }}
                        className="w-full aspect-square rounded-lg border border-border/60 hover:bg-accent p-1 disabled:opacity-50"
                      >
                        <img src={s.url} alt="Figurinha" className="w-full h-full object-contain" loading="lazy" />
                      </button>
                      {onDeleteSticker && (
                        <button
                          type="button"
                          title="Remover figurinha"
                          onClick={() => onDeleteSticker(s)}
                          className="absolute -top-1 -right-1 hidden group-hover:flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
                        >
                          <Trash2 size={11} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}

            <p className="text-[11px] text-muted-foreground mb-2 leading-snug">
              Emojis grandes: clique para enviar na hora. Enviado sozinho, aparece ampliado.
            </p>
            <div className="grid grid-cols-6 gap-1 max-h-40 overflow-y-auto overscroll-contain">
              {STICKERS.map((e, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    onSendSticker(e);
                    setOpen(false);
                  }}
                  className="aspect-square flex items-center justify-center text-3xl rounded-lg border border-border/60 hover:bg-accent"
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
