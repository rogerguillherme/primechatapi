import { useState, useRef, useCallback } from "react";
import { Mic, Square, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// O WhatsApp Cloud API recusa audio/webm (erro 131053) — os únicos containers
// aceitos são ogg/opus, mpeg, amr, mp4 e aac. Grava no primeiro que o navegador
// suportar; webm fica só como último recurso, para não voltar a gravar mudo.
const WHATSAPP_AUDIO_TYPES = [
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/mpeg",
  "audio/aac",
];

export function pickAudioMimeType(): string {
  const supported = WHATSAPP_AUDIO_TYPES.find(
    (t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t),
  );
  return supported || "audio/webm;codecs=opus";
}

const EXT_BY_MIME: Record<string, string> = {
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/aac": "aac",
  "audio/webm": "webm",
};

/** Converte o blob gravado num File com extensão coerente com o container. */
export function audioFileFromBlob(blob: Blob): File {
  const base = (blob.type || "audio/webm").split(";")[0].trim();
  return new File([blob], `audio.${EXT_BY_MIME[base] || "webm"}`, { type: base });
}

interface AudioRecorderProps {
  onRecorded: (blob: Blob) => void;
  disabled?: boolean;
}

export function AudioRecorder({ onRecorded, disabled }: AudioRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickAudioMimeType();
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mediaRecorder.mimeType || mimeType });
        onRecorded(blob);
        stream.getTracks().forEach((t) => t.stop());
      };

      mediaRecorder.start(100);
      setRecording(true);
      setDuration(0);
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    } catch (err) {
      console.error("Mic access denied:", err);
    }
  }, [onRecorded]);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const formatTime = (t: number) => {
    const m = Math.floor(t / 60);
    const s = t % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  if (recording) {
    return (
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        <span className="text-sm text-red-500 font-medium tabular-nums">{formatTime(duration)}</span>
        <button
          onClick={stopRecording}
          className="p-2.5 rounded-full bg-red-500 text-white hover:bg-red-600 transition-colors"
        >
          <Square size={16} fill="white" />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={startRecording}
      disabled={disabled}
      className="p-2 rounded-full hover:bg-accent text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 mb-[3px]"
    >
      <Mic size={22} />
    </button>
  );
}
