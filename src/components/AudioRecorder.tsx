import { useState, useRef, useCallback } from "react";
import { Mic, Square } from "lucide-react";

// O WhatsApp só exibe o áudio como MENSAGEM DE VOZ quando ele vem em OGG/Opus.
// Qualquer outro container aceito (mp4, mpeg, aac) chega como arquivo anexado.
// O Chrome não grava OGG pelo MediaRecorder, então usamos o opus-recorder, que
// codifica em Opus e monta o container Ogg no próprio navegador.
//
// O encoder é um worker + WebAssembly de ~100 KB. Ele é importado sob demanda,
// no clique do microfone, para não voltar a engordar o carregamento inicial.

const OGG_MIME = "audio/ogg";

// Fallback: navegador sem suporte ao encoder cai no MediaRecorder, nestes
// containers, nesta ordem. Chega como arquivo em vez de mensagem de voz, mas
// chega — melhor que o operador ficar sem gravar.
const FALLBACK_TYPES = ["audio/ogg;codecs=opus", "audio/mp4", "audio/mpeg", "audio/aac"];

export function pickFallbackMimeType(): string {
  const supported = FALLBACK_TYPES.find(
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
  const base = (blob.type || OGG_MIME).split(";")[0].trim();
  return new File([blob], `audio.${EXT_BY_MIME[base] || "ogg"}`, { type: base });
}

/**
 * Confere se o que saiu do gravador é mesmo um arquivo utilizável.
 *
 * A Meta recusava com "declarado audio/ogg, mas ao processar é
 * application/octet-stream" — que é o jeito dela de dizer "isso não é um Ogg".
 * Um arquivo vazio ou só com cabeçalho produz exatamente essa resposta, e a
 * pessoa só descobria depois de gravar e enviar.
 *
 * Ogg começa sempre com a assinatura "OggS". Ler os primeiros bytes é barato
 * e transforma um erro obscuro da Meta num aviso local e imediato.
 */
export async function validarAudio(blob: Blob): Promise<string | null> {
  // Um Ogg/Opus de meio segundo já passa de 2 KB. Abaixo disso é cabeçalho solto.
  if (blob.size < 2048) {
    return "A gravação saiu vazia. Verifique se o microfone está liberado para o site e tente de novo.";
  }

  const base = (blob.type || "").split(";")[0].trim();
  if (base === "audio/ogg") {
    try {
      const inicio = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
      const assinatura = String.fromCharCode(...inicio);
      if (assinatura !== "OggS") {
        return "O áudio gravado saiu corrompido neste navegador. Tente novamente ou envie como arquivo.";
      }
    } catch {
      /* não conseguiu ler: deixa seguir e a Meta decide */
    }
  }
  return null;
}

interface AudioRecorderProps {
  onRecorded: (blob: Blob) => void;
  /** Avisa o operador quando não dá para gravar num formato aceito. */
  onError?: (mensagem: string) => void;
  disabled?: boolean;
}

/** Interface mínima que usamos das duas gravações possíveis. */
interface Stoppable {
  stop: () => void;
}

export function AudioRecorder({ onRecorded, onError, disabled }: AudioRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const recorderRef = useRef<Stoppable | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const beginTimer = () => {
    setRecording(true);
    setDuration(0);
    timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
  };

  const clearTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  /** Caminho antigo, só quando o encoder Opus não puder ser usado. */
  const startWithMediaRecorder = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = pickFallbackMimeType();
    const rec = new MediaRecorder(stream, { mimeType });
    const chunks: Blob[] = [];

    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => {
      onRecorded(new Blob(chunks, { type: rec.mimeType || mimeType }));
      stream.getTracks().forEach((t) => t.stop());
    };

    rec.start(100);
    recorderRef.current = rec;
    beginTimer();
  }, [onRecorded]);

  const startRecording = useCallback(async () => {
    try {
      const [{ default: Recorder }, { default: encoderPath }] = await Promise.all([
        import("opus-recorder"),
        import("opus-recorder/dist/encoderWorker.min.js?url"),
      ]);

      const rec = new Recorder({
        encoderPath,
        // Mensagem de voz é mono; estéreo só dobra o tamanho sem ganho.
        numberOfChannels: 1,
        encoderSampleRate: 48000,
        // 2048 = OPUS_APPLICATION_VOIP, perfil que o Opus usa para fala.
        encoderApplication: 2048,
        // Uma página só no fim: queremos o arquivo Ogg completo, não streaming.
        streamPages: false,
      });

      rec.ondataavailable = (data: Uint8Array) => {
        // Copiamos para um ArrayBuffer próprio: o tipo do encoder pode apontar
        // para SharedArrayBuffer, que o construtor de Blob não aceita.
        const bytes = new Uint8Array(data.byteLength);
        bytes.set(data);
        onRecorded(new Blob([bytes.buffer], { type: OGG_MIME }));
      };

      await rec.start();
      recorderRef.current = rec;
      beginTimer();
    } catch (err) {
      // Encoder indisponível (navegador antigo, worker bloqueado). O caminho
      // antigo só ajuda se o navegador gravar num container que o WhatsApp
      // aceita — em Chrome ele produz webm, que a Meta recusa. Antes isso
      // seguia calado até o envio falhar com uma mensagem confusa.
      console.warn("Encoder Opus indisponível, tentando o MediaRecorder:", err);
      const alternativo = pickFallbackMimeType();
      if (alternativo.startsWith("audio/webm")) {
        onError?.(
          "Não consegui preparar o áudio neste navegador — o WhatsApp não aceita o " +
            "formato que ele grava. Tente pelo Chrome atualizado ou envie o áudio como arquivo.",
        );
        return;
      }
      try {
        await startWithMediaRecorder();
      } catch (fallbackErr) {
        console.error("Não foi possível acessar o microfone:", fallbackErr);
        onError?.("Não foi possível acessar o microfone.");
      }
    }
  }, [onRecorded, onError, startWithMediaRecorder]);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
    clearTimer();
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
          aria-label="Parar gravação"
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
      aria-label="Gravar áudio"
      className="p-2 rounded-full hover:bg-accent text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 mb-[3px]"
    >
      <Mic size={22} />
    </button>
  );
}
