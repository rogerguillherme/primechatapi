import { useMemo, useState } from "react";
import { Smile } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Seletor de emojis e figurinhas do chat.
 *
 * - Aba "Emojis": insere o caractere no campo de mensagem (onSelect).
 * - Aba "Figurinhas": envia na hora um emoji grande/combo (onSendSticker),
 *   que o WhatsApp renderiza em tamanho ampliado quando é a única coisa
 *   na mensagem. Não usamos .webp de sticker porque exigiria upload de
 *   mídia e aprovação de formato pela Meta.
 */
export interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onSendSticker: (emoji: string) => void;
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

export function EmojiPicker({ onSelect, onSendSticker, disabled }: EmojiPickerProps) {
  const [open, setOpen] = useState(false);
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
            <p className="text-[11px] text-muted-foreground mb-2 leading-snug">
              Clique para enviar na hora. Enviada sozinha, aparece grande na conversa.
            </p>
            <div className="grid grid-cols-6 gap-1 max-h-64 overflow-y-auto overscroll-contain">
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
