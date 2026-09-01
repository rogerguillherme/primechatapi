import { useState, useRef, useEffect } from "react";
import { Play, Pause, Download, Loader2, Plus, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatMediaBubbleProps {
  mediaType: string;
  mediaUrl: string;
  caption?: string;
  isOutbound: boolean;
  /**
   * Salva a figurinha na biblioteca do usuário. Ausente = sem botão (telas que
   * só leem o histórico não precisam da ação).
   */
  onSaveSticker?: (mediaUrl: string) => void | Promise<void>;
}

/**
 * Figurinha no histórico, com atalho para guardar na biblioteca.
 *
 * Sem moldura nem legenda — o WhatsApp também a mostra solta. O botão aparece
 * no hover para não competir com a imagem, e vira "✓" depois de salvar: sem
 * confirmação visível, o operador clica de novo e duplica a figurinha.
 */
function StickerBubble({
  mediaUrl,
  caption,
  onSaveSticker,
}: Pick<ChatMediaBubbleProps, "mediaUrl" | "caption" | "onSaveSticker">) {
  const [estado, setEstado] = useState<"idle" | "salvando" | "salvo">("idle");

  const salvar = async () => {
    if (!onSaveSticker || estado !== "idle") return;
    setEstado("salvando");
    try {
      await onSaveSticker(mediaUrl);
      setEstado("salvo");
    } catch {
      // O erro já é reportado por quem salva (toast); aqui só liberamos o botão.
      setEstado("idle");
    }
  };

  return (
    <div className="relative group/sticker w-[140px]">
      <img
        src={mediaUrl}
        alt={caption || "Figurinha"}
        className="w-[140px] h-[140px] object-contain"
        loading="lazy"
      />
      {onSaveSticker && (
        <button
          type="button"
          onClick={salvar}
          disabled={estado !== "idle"}
          title={estado === "salvo" ? "Figurinha salva na biblioteca" : "Salvar figurinha"}
          aria-label={estado === "salvo" ? "Figurinha salva na biblioteca" : "Salvar figurinha"}
          className={cn(
            "absolute top-0 right-0 p-1.5 rounded-full bg-background/90 border border-border shadow-sm",
            "text-muted-foreground hover:text-foreground transition-opacity",
            "focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring",
            estado === "salvo"
              ? "opacity-100 text-primary"
              : "opacity-0 group-hover/sticker:opacity-100",
          )}
        >
          {estado === "salvando" ? (
            <Loader2 size={14} className="animate-spin" />
          ) : estado === "salvo" ? (
            <Check size={14} />
          ) : (
            <Plus size={14} />
          )}
        </button>
      )}
    </div>
  );
}

/** Velocidades de reprodução, na ordem em que o botão alterna. */
const SPEEDS = [1, 1.5, 2, 3] as const;
const SPEED_KEY = "prime-chat:audio-speed";

const EXT_POR_MIME: Record<string, string> = {
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "audio/webm": "webm",
};

/**
 * Baixa o áudio como arquivo.
 *
 * O atributo `download` num link é IGNORADO quando o arquivo vem de outra
 * origem — e as mídias vêm do storage, que é outra origem. O link então só
 * abriria o áudio numa aba, que não é baixar. Puxar o conteúdo e entregar um
 * blob local contorna isso, porque aí a origem passa a ser a própria página.
 *
 * Se o storage não liberar a leitura por CORS, abrir numa aba é o que resta —
 * pior que baixar, melhor que um botão que não faz nada.
 */
async function baixarAudio(src: string) {
  try {
    const res = await fetch(src);
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    const base = (blob.type || "").split(";")[0].trim();
    const daUrl = src.split("?")[0].split(".").pop()?.toLowerCase() || "";
    const ext = EXT_POR_MIME[base] || (daUrl.length <= 4 ? daUrl : "") || "ogg";

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audio-${new Date().toISOString().slice(0, 10)}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch {
    window.open(src, "_blank", "noopener,noreferrer");
  }
}

/** Lê a velocidade escolhida antes. Voltar para 1x a cada áudio irrita. */
function storedSpeed(): number {
  try {
    const v = Number(localStorage.getItem(SPEED_KEY));
    return SPEEDS.includes(v as any) ? v : 1;
  } catch {
    return 1;
  }
}

function AudioPlayer({ src, isOutbound }: { src: string; isOutbound: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(storedSpeed);
  const [baixando, setBaixando] = useState(false);

  // O elemento é recriado a cada render de mídia nova; reaplica a velocidade.
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed, src]);

  const cycleSpeed = () => {
    const proxima = SPEEDS[(SPEEDS.indexOf(speed as any) + 1) % SPEEDS.length];
    setSpeed(proxima);
    if (audioRef.current) audioRef.current.playbackRate = proxima;
    try {
      localStorage.setItem(SPEED_KEY, String(proxima));
    } catch {
      /* navegador sem armazenamento: vale só para esta sessão */
    }
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setPlaying(!playing);
  };

  const handleTimeUpdate = () => {
    if (!audioRef.current) return;
    setProgress(audioRef.current.currentTime);
  };

  const handleLoadedMetadata = () => {
    if (!audioRef.current) return;
    // Áudio em stream (ou ogg sem cabeçalho de duração) reporta Infinity/NaN.
    // Sem esta guarda, o formatador imprimia "Infinity:NaN" na bolha.
    const d = audioRef.current.duration;
    setDuration(Number.isFinite(d) && d > 0 ? d : 0);
  };

  const handleEnded = () => setPlaying(false);

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    audioRef.current.currentTime = ratio * duration;
  };

  const formatTime = (t: number) => {
    if (!Number.isFinite(t) || t < 0) return "--:--";
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex items-center gap-2 min-w-[200px]">
      <audio
        ref={audioRef}
        src={src}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        preload="metadata"
      />
      <button
        onClick={togglePlay}
        className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0",
          isOutbound ? "bg-[#4fc3f7]/20 text-[#0d7377]" : "bg-primary/10 text-primary"
        )}
      >
        {playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
      </button>
      <div className="flex-1 flex flex-col gap-0.5">
        <div
          className="h-1.5 rounded-full bg-black/10 cursor-pointer relative overflow-hidden"
          onClick={handleSeek}
        >
          <div
            className={cn("h-full rounded-full transition-all", isOutbound ? "bg-[#4fc3f7]" : "bg-primary")}
            style={{ width: duration ? `${(progress / duration) * 100}%` : "0%" }}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] opacity-60">
            {formatTime(playing ? progress : duration || 0)}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={cycleSpeed}
              title="Velocidade de reprodução"
              aria-label={`Velocidade ${speed}x — clique para mudar`}
              className={cn(
                "text-[10px] font-semibold px-1.5 py-0.5 rounded transition-colors tabular-nums",
                speed === 1 ? "opacity-60 hover:opacity-100" : "opacity-100",
                isOutbound ? "bg-[#4fc3f7]/20 text-[#0d7377]" : "bg-primary/10 text-primary",
              )}
            >
              {speed}×
            </button>
            <button
              type="button"
              onClick={() => { setBaixando(true); void baixarAudio(src).finally(() => setBaixando(false)); }}
              disabled={baixando}
              title="Baixar áudio"
              aria-label="Baixar áudio"
              className="p-1 rounded opacity-60 hover:opacity-100 transition-opacity disabled:opacity-40"
            >
              {baixando ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ChatMediaBubble({ mediaType, mediaUrl, caption, isOutbound, onSaveSticker }: ChatMediaBubbleProps) {
  if (mediaType === "audio") {
    return <AudioPlayer src={mediaUrl} isOutbound={isOutbound} />;
  }

  if (mediaType === "sticker") {
    return <StickerBubble mediaUrl={mediaUrl} caption={caption} onSaveSticker={onSaveSticker} />;
  }

  if (mediaType === "image") {
    return (
      <div className="space-y-1">
        <img
          src={mediaUrl}
          alt={caption || "Image"}
          className="rounded-md max-w-[280px] max-h-[300px] object-cover cursor-pointer"
          onClick={() => window.open(mediaUrl, "_blank")}
          loading="lazy"
        />
        {caption && <p className="whitespace-pre-wrap break-words text-[13.5px]">{caption}</p>}
      </div>
    );
  }

  if (mediaType === "video") {
    return (
      <div className="space-y-1">
        <video
          src={mediaUrl}
          controls
          className="rounded-md max-w-[280px] max-h-[300px]"
          preload="metadata"
        />
        {caption && <p className="whitespace-pre-wrap break-words text-[13.5px]">{caption}</p>}
      </div>
    );
  }

  // Document or unknown
  return (
    <a
      href={mediaUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "flex items-center gap-2 p-2 rounded-md",
        isOutbound ? "bg-black/5" : "bg-muted/50"
      )}
    >
      <Download size={18} className="flex-shrink-0 opacity-60" />
      <span className="text-sm truncate">{caption || "Documento"}</span>
    </a>
  );
}
