import { useState, useRef, useCallback, useEffect } from "react";
import { Mic, Square, Play, Pause, Send, Trash2 } from "lucide-react";

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
  /** Chamado só quando a pessoa confirma o envio, nunca ao parar a gravação. */
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

  // Parar de gravar deixou de ser o mesmo que enviar. Antes o áudio saía no
  // instante em que se soltava o botão: sem ouvir antes, sem desistir depois.
  // Um engano custava uma mensagem de voz errada no WhatsApp do cliente.
  const [gravado, setGravado] = useState<Blob | null>(null);
  const [tocando, setTocando] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  const descartarPreview = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setTocando(false);
    setGravado(null);
    setDuration(0);
  }, []);

  // A URL do blob vive enquanto a prévia existir; sem revogar, cada gravação
  // descartada fica presa na memória da aba.
  useEffect(() => descartarPreview, [descartarPreview]);

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
      setGravado(new Blob(chunks, { type: rec.mimeType || mimeType }));
      stream.getTracks().forEach((t) => t.stop());
    };

    rec.start(100);
    recorderRef.current = rec;
    beginTimer();
  }, []);

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
        setGravado(new Blob([bytes.buffer], { type: OGG_MIME }));
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
  }, [onError, startWithMediaRecorder]);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
    clearTimer();
  }, []);

  const alternarReproducao = useCallback(() => {
    if (!gravado) return;
    if (!audioRef.current) {
      urlRef.current = URL.createObjectURL(gravado);
      const el = new Audio(urlRef.current);
      el.onended = () => setTocando(false);
      el.onpause = () => setTocando(false);
      el.onplay = () => setTocando(true);
      audioRef.current = el;
    }
    if (audioRef.current.paused) void audioRef.current.play();
    else audioRef.current.pause();
  }, [gravado]);

  const enviar = useCallback(() => {
    if (!gravado) return;
    const blob = gravado;
    descartarPreview();
    onRecorded(blob);
  }, [gravado, descartarPreview, onRecorded]);

  const formatTime = (t: number) => {
    const m = Math.floor(t / 60);
    const s = t % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  // Gravado e ainda não enviado: ouvir, apagar ou mandar.
  if (gravado) {
    return (
      <div className="flex items-center gap-1.5 rounded-full border border-border bg-muted/40 pl-1 pr-1.5 py-1">
        <button
          onClick={alternarReproducao}
          aria-label={tocando ? "Pausar áudio" : "Ouvir áudio gravado"}
          title={tocando ? "Pausar" : "Ouvir"}
          className="p-1.5 rounded-full hover:bg-accent text-foreground transition-colors"
        >
          {tocando ? <Pause size={16} /> : <Play size={16} />}
        </button>

        <span className="text-xs font-medium tabular-nums text-muted-foreground px-0.5">
          {formatTime(duration)}
        </span>

        <button
          onClick={descartarPreview}
          disabled={disabled}
          aria-label="Descartar áudio"
          title="Descartar"
          className="p-1.5 rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors disabled:opacity-50"
        >
          <Trash2 size={16} />
        </button>

        <button
          onClick={enviar}
          disabled={disabled}
          aria-label="Enviar áudio"
          title="Enviar"
          className="p-1.5 rounded-full bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          <Send size={16} />
        </button>
      </div>
    );
  }

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
