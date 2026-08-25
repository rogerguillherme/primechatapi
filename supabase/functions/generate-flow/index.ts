import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type Attachment = {
  name?: string;
  mimeType?: string;
  text?: string;
  dataUrl?: string;
  kind?: "text" | "pdf" | "image" | "audio";
};

type FlowStep = {
  type: "message" | "delay" | "condition" | "interactive_buttons" | "cta_url" | "no_response" | "ai_agent" | "tag";
  data: Record<string, unknown>;
};

type DataCrazyMessage = {
  name?: string;
  group?: string;
  stepId?: string;
  options?: Record<string, unknown>;
};

type DataCrazyBlock = {
  id?: string;
  type?: string;
  options?: Record<string, unknown>;
};

type DataCrazyAutomation = {
  name?: string;
  description?: string;
  blocks?: DataCrazyBlock[];
};

type DataCrazyMediaCandidate = {
  url: string;
  fileName: string;
  mimeType: string;
  platform?: string;
};

type MediaMirrorResult = {
  signedUrl: string;
  mimeType: string;
  fileName: string;
};

const AUDIO_EXTENSIONS: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mpga": "mp3",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/ogg": "ogg",
  "audio/oga": "ogg",
  "audio/wav": "wav",
  "audio/wave": "wav",
  "audio/vnd.wave": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
  "video/webm": "webm",
  "audio/aac": "aac",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
};

const AUDIO_MIME_BY_EXTENSION: Record<string, string> = {
  mp3: "audio/mpeg",
  mpga: "audio/mpeg",
  mpeg: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  wav: "audio/wav",
  wave: "audio/wav",
  webm: "audio/webm",
  aac: "audio/aac",
  flac: "audio/flac",
};

const TRANSCRIPTION_URL = "https://ai.gateway.lovable.dev/v1/audio/transcriptions";
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

const SYSTEM_PROMPT = `Você é um compilador de roteiros para fluxos de automação de WhatsApp.

MISSÃO: transformar o ROTEIRO enviado pelo usuário (texto colado e/ou documento anexado) em um array JSON de passos do fluxo, reproduzindo o conteúdo EXATAMENTE como está escrito no documento.

REGRAS DE FIDELIDADE (prioridade máxima):
1. Copie os textos das mensagens LITERALMENTE — caractere por caractere, incluindo emojis, quebras de linha (\\n), pontuação, MAIÚSCULAS, negrito no formato do WhatsApp (*texto*) e variáveis como {nome} ou {telefone}.
2. NÃO reescreva, resuma, traduza, "melhore", corrija ortografia nem invente conteúdo que não exista no documento.
3. Mantenha a ORDEM exata em que as mensagens aparecem no documento.
4. Gere um passo para CADA mensagem/bloco do documento — não agrupe mensagens distintas nem descarte nenhuma. Não há limite de passos: se o documento tem 30 mensagens, gere 30 passos.
5. Só crie passos de "delay" quando o documento indicar um tempo de espera (ex.: "aguardar 10 min", "após 1 dia", "no dia seguinte", horários). Converta para minutos (1h = 60, 1 dia = 1440).
6. Títulos de botões devem ser copiados literalmente e respeitar o limite de 20 caracteres da Meta; máximo de 3 botões por passo.
7. Se o documento tiver URLs em botões, use o tipo "cta_url" com a URL exata.
8. Cabeçalhos organizacionais do documento (ex.: "Mensagem 1", "Etapa 2", "Dia 3") são metadados: NÃO os inclua no texto da mensagem.

TIPOS DE PASSO DISPONÍVEIS e formato de "data":
- message: { "custom_message": "texto literal" }
- delay: { "delay_minutes": number }
- condition: { "trigger_value": "texto da condição", "match_mode": "exact" | "contains" | "ai", "ai_match_description": "descrição quando match_mode = ai" }
- interactive_buttons: { "custom_message": "texto", "buttons": [{ "id": "hex", "title": "texto do botão" }] }
- cta_url: { "custom_message": "texto", "buttons": [{ "id": "hex", "title": "texto do botão", "url": "https://..." }] }
- no_response: { "timeout_minutes": number, "custom_message": "texto opcional" }
- ai_agent: { "ai_prompt": "instruções", "max_interactions": number }
- tag: { "label_ids": [], "trigger_value": "nome da etiqueta descrita no documento" }

SAÍDA: responda SOMENTE com o array JSON válido (sem markdown, sem comentários, sem explicação).
Cada item do array: { "type": "<tipo>", "data": { ... } }.
IDs de botão: strings hexadecimais curtas e únicas (ex.: "a1b2c3").`;

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

const mimeToMediaType = (mimeType: string): "image" | "video" | "audio" | "document" => {
  const base = getBaseMimeType(mimeType);
  if (base.startsWith("image/")) return "image";
  if (base.startsWith("video/")) return "video";
  if (base.startsWith("audio/")) return "audio";
  return "document";
};

const safeFileName = (name: string, mimeType: string): string => {
  const clean = (name || "midia").replace(/[^a-zA-Z0-9._ -]/g, "_").trim() || "midia";
  if (/\.[a-z0-9]{2,5}$/i.test(clean)) return clean;
  const ext = mimeType.includes("jpeg") ? "jpg"
    : mimeType.includes("png") ? "png"
      : mimeType.includes("webp") ? "webp"
        : mimeType.includes("mp4") ? "mp4"
          : mimeType.includes("mpeg") ? "mp3"
            : mimeType.includes("ogg") ? "ogg"
              : mimeType.includes("wav") ? "wav"
                : "bin";
  return `${clean}.${ext}`;
};

const getString = (value: unknown): string => typeof value === "string" ? value : "";
const getNumber = (value: unknown): number => typeof value === "number" && Number.isFinite(value) ? value : 0;

const normalizeDataCrazyText = (text: string): string =>
  sanitizeText(text)
    .replace(/\{\s*Primeiro nome do lead\s*\|\s*leadFirstName\s*\}/gi, "{nome}")
    .replace(/\{\s*Nome do lead\s*\|\s*leadName\s*\}/gi, "{nome_completo}")
    .replace(/\{\s*Telefone do lead\s*\|\s*leadPhone\s*\}/gi, "{telefone}");

const parseJsonMaybe = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const asMessages = (value: unknown): DataCrazyMessage[] =>
  Array.isArray(value) ? value.filter((item): item is DataCrazyMessage => !!item && typeof item === "object") : [];

const asBlocks = (value: unknown): DataCrazyBlock[] =>
  Array.isArray(value) ? value.filter((item): item is DataCrazyBlock => !!item && typeof item === "object") : [];

const asAutomations = (value: unknown): DataCrazyAutomation[] =>
  Array.isArray(value) ? value.filter((item): item is DataCrazyAutomation => !!item && typeof item === "object") : [];

function extractDataCrazyAutomations(parsed: unknown): DataCrazyAutomation[] {
  const root = asObject(parsed);
  const data = asObject(root?.data);
  const direct = asAutomations(root?.automations);
  const nested = asAutomations(data?.automations);
  return nested.length > 0 ? nested : direct;
}

function pickDataCrazyMedia(options: Record<string, unknown>): DataCrazyMediaCandidate | null {
  const platforms = Array.isArray(options.platforms)
    ? options.platforms.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    : [];

  const platformPreferred = platforms.find((item) => getString(item.platform).toUpperCase() === "WHATSAPP" && getString(item.url))
    || platforms.find((item) => getString(item.url));

  const url = getString(platformPreferred?.url) || getString(options.url);
  if (!url) return null;

  const mimeType = getString(platformPreferred?.mimeType) || getString(options.mimeType) || "application/octet-stream";
  const fileName = getString(platformPreferred?.filename) || getString(options.filename) || safeFileName("midia", mimeType);

  return {
    url,
    mimeType,
    fileName: safeFileName(fileName, mimeType),
    platform: getString(platformPreferred?.platform) || undefined,
  };
}

async function mirrorDataCrazyMedia(
  candidate: DataCrazyMediaCandidate,
  supabase: ReturnType<typeof createClient>,
  cache: Map<string, MediaMirrorResult>,
): Promise<MediaMirrorResult> {
  const cached = cache.get(candidate.url);
  if (cached) return cached;

  try {
    const source = await fetch(candidate.url, {
      headers: { "User-Agent": "PrimeChat-FlowImporter/1.0" },
    });
    if (!source.ok) throw new Error(`download ${source.status}`);

    const sourceType = getBaseMimeType(source.headers.get("content-type") || "") || candidate.mimeType;
    const mimeType = getBaseMimeType(sourceType) || candidate.mimeType || "application/octet-stream";
    const fileName = safeFileName(candidate.fileName, mimeType);
    const extension = getFileExtension(fileName) || "bin";
    const path = `flow-imports/${crypto.randomUUID()}.${extension}`;
    const bytes = await source.arrayBuffer();

    const { error: uploadError } = await supabase.storage
      .from("chat-media")
      .upload(path, bytes, { contentType: mimeType, upsert: false });
    if (uploadError) throw uploadError;

    const { data: signed, error: signError } = await supabase.storage
      .from("chat-media")
      .createSignedUrl(path, 60 * 60 * 24 * 365);
    if (signError || !signed?.signedUrl) throw signError || new Error("Falha ao gerar URL assinada");

    const result = { signedUrl: signed.signedUrl, mimeType, fileName };
    cache.set(candidate.url, result);
    return result;
  } catch (error) {
    console.error("Falha ao espelhar mídia do Data Crazy; mantendo URL original:", candidate.url, error);
    const fallback = {
      signedUrl: candidate.url,
      mimeType: candidate.mimeType || "application/octet-stream",
      fileName: candidate.fileName,
    };
    cache.set(candidate.url, fallback);
    return fallback;
  }
}

function appendDelayStep(steps: FlowStep[], seconds: number): void {
  const safeSeconds = Math.max(1, Math.round(seconds || 1));
  steps.push({
    type: "delay",
    data: { delay_minutes: 0, delay_min_seconds: safeSeconds, delay_max_seconds: safeSeconds },
  });
}

function dataCrazyDelaySeconds(block: DataCrazyBlock): number {
  const options = asObject(block.options);
  const delay = asObject(options?.delay);
  const delayOptions = asObject(delay?.options);
  const seconds = getNumber(delayOptions?.seconds) || getNumber(options?.seconds);
  const minutes = getNumber(delayOptions?.minutes) || getNumber(options?.minutes);
  const hours = getNumber(delayOptions?.hours) || getNumber(options?.hours);
  const days = getNumber(delayOptions?.days) || getNumber(options?.days);
  return seconds + minutes * 60 + hours * 3600 + days * 86400;
}

async function appendDataCrazyMessageStep(
  steps: FlowStep[],
  message: DataCrazyMessage,
  supabase: ReturnType<typeof createClient>,
  mediaCache: Map<string, MediaMirrorResult>,
): Promise<void> {
  const options = asObject(message.options) || {};
  const name = getString(message.name);

  if (name === "delay-message") {
    appendDelayStep(steps, getNumber(options.seconds) || 1);
    return;
  }

  if (name === "send-text-message") {
    const text = normalizeDataCrazyText(getString(options.text));
    const buttons = Array.isArray(options.buttons)
      ? options.buttons.map((button) => asObject(button)).filter(Boolean)
      : [];

    if (buttons.length > 0) {
      steps.push({
        type: "interactive_buttons",
        data: {
          custom_message: text,
          buttons: buttons.slice(0, 3).map((button, index) => ({
            id: crypto.randomUUID().replace(/-/g, "").slice(0, 8),
            title: (getString(button?.title) || getString(button?.text) || `Opção ${index + 1}`).slice(0, 20),
          })),
        },
      });
      return;
    }

    if (text.trim()) {
      steps.push({
        type: "message",
        data: {
          custom_message: text,
          template_id: null,
          media_url: null,
          media_type: null,
          message_variations: [],
          template_variations: [],
        },
      });
    }
    return;
  }

  if (name === "send-file-message") {
    const media = pickDataCrazyMedia(options);
    if (!media) return;
    const mirrored = await mirrorDataCrazyMedia(media, supabase, mediaCache);
    steps.push({
      type: "message",
      data: {
        custom_message: normalizeDataCrazyText(getString(options.text)),
        template_id: null,
        media_url: mirrored.signedUrl,
        media_type: mimeToMediaType(mirrored.mimeType),
        file_name: mirrored.fileName,
        message_variations: [],
        template_variations: [],
      },
    });
    return;
  }

  if (name === "text-input-message") {
    const timeoutSeconds = getNumber(options.timeoutInSeconds);
    steps.push({
      type: "no_response",
      data: { timeout_minutes: Math.max(1, Math.ceil((timeoutSeconds || 600) / 60)) },
    });
  }
}

async function compileDataCrazyAutomation(
  automation: DataCrazyAutomation,
  supabase: ReturnType<typeof createClient>,
): Promise<FlowStep[]> {
  const blocks = asBlocks(automation.blocks);
  const blockById = new Map(blocks.map((block) => [getString(block.id), block]).filter(([id]) => id));
  const visited = new Set<string>();
  const mediaCache = new Map<string, MediaMirrorResult>();
  const steps: FlowStep[] = [];

  const firstTrigger = blocks.find((block) => block.type === "trigger" && getString(asObject(block.options)?.nextBlockId));
  const firstChat = blocks.find((block) => block.type === "chat");

  const walk = async (blockId: string): Promise<void> => {
    if (!blockId || visited.has(blockId)) return;
    visited.add(blockId);

    const block = blockById.get(blockId);
    if (!block) return;
    const options = asObject(block.options) || {};

    if (block.type === "delay") {
      appendDelayStep(steps, dataCrazyDelaySeconds(block) || 1);
    }

    if (block.type === "chat") {
      for (const message of asMessages(options.messages)) {
        await appendDataCrazyMessageStep(steps, message, supabase, mediaCache);
        const messageOptions = asObject(message.options) || {};
        const timeoutNextBlockId = getString(messageOptions.timeoutNextBlockId);
        if (message.name === "text-input-message" && timeoutNextBlockId) {
          await walk(timeoutNextBlockId);
        }
      }
    }

    await walk(getString(options.nextBlockId));
  };

  await walk(getString(asObject(firstTrigger?.options)?.nextBlockId) || getString(firstChat?.id));
  return steps;
}

async function tryCompileDataCrazyAttachments(attachments: Attachment[]): Promise<FlowStep[] | null> {
  const jsonAttachment = attachments.find((attachment) =>
    attachment.kind === "text" &&
    typeof attachment.text === "string" &&
    (attachment.name?.toLowerCase().endsWith(".json") || attachment.text.includes('"automations"'))
  );
  if (!jsonAttachment?.text) return null;

  const automations = extractDataCrazyAutomations(parseJsonMaybe(jsonAttachment.text));
  if (automations.length === 0) return null;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Storage do backend não configurado para importar mídias do fluxo.");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const steps = await compileDataCrazyAutomation(automations[0], supabase);
  return steps.length > 0 ? steps : null;
}

type TranscriptionResult =
  | { ok: true; text: string }
  | { ok: false; status: number; message: string };

function getBaseMimeType(value?: string): string {
  return (value || "").split(";")[0].trim().toLowerCase();
}

function getFileExtension(fileName: string): string {
  const extension = fileName.split(".").pop()?.trim().toLowerCase() || "";
  return extension === fileName.toLowerCase() ? "" : extension;
}

function resolveAudioFileType(
  decodedMimeType: string,
  declaredMimeType: string,
  fileName: string,
): { mimeType: string; extension: string } | null {
  const fileExtension = getFileExtension(fileName);
  const candidates = [
    getBaseMimeType(decodedMimeType),
    getBaseMimeType(declaredMimeType),
    AUDIO_MIME_BY_EXTENSION[fileExtension] || "",
  ];

  for (const candidate of candidates) {
    const extension = AUDIO_EXTENSIONS[candidate];
    if (extension) return { mimeType: candidate, extension };
  }

  const extensionFromName = AUDIO_MIME_BY_EXTENSION[fileExtension] ? fileExtension : "";
  if (extensionFromName) {
    return { mimeType: AUDIO_MIME_BY_EXTENSION[extensionFromName], extension: extensionFromName };
  }

  return null;
}

function decodeAudioDataUrl(dataUrl: string): { bytes: Uint8Array; mimeType: string } | null {
  const match = /^data:([^,]*),([\s\S]+)$/i.exec(dataUrl.trim());
  if (!match) return null;

  const metadata = match[1];
  if (!/(^|;)base64(;|$)/i.test(metadata)) return null;

  try {
    const binary = atob(match[2].replace(/\s/g, ""));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return { bytes, mimeType: getBaseMimeType(metadata) };
  } catch {
    return null;
  }
}

async function readGatewayError(response: Response): Promise<string> {
  const detail = (await response.text()).slice(0, 1000);
  try {
    const parsed = JSON.parse(detail) as Record<string, unknown>;
    const error = parsed.error;
    if (error && typeof error === "object" && "message" in error) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) return message.trim();
    }
    if (typeof parsed.message === "string" && parsed.message.trim()) return parsed.message.trim();
  } catch {
    // A resposta de erro pode ser texto puro.
  }
  return detail || "O serviço de IA recusou a solicitação.";
}

/**
 * Transcreve um áudio em uma chamada isolada.
 * Isolar a transcrição evita que o modelo misture bytes do áudio
 * (base64) no texto das mensagens do fluxo.
 */
async function transcribeAudio(
  dataUrl: string,
  fileName: string,
  declaredMimeType: string,
  apiKey: string,
): Promise<TranscriptionResult> {
  try {
    const decoded = decodeAudioDataUrl(dataUrl);
    if (!decoded || decoded.bytes.length === 0) {
      return { ok: false, status: 400, message: "O arquivo de áudio está vazio ou corrompido." };
    }
    if (decoded.bytes.length > MAX_AUDIO_BYTES) {
      return { ok: false, status: 413, message: "O áudio excede o limite de 20MB." };
    }

    const audioFileType = resolveAudioFileType(decoded.mimeType, declaredMimeType, fileName);
    if (!audioFileType) {
      const receivedType = getBaseMimeType(decoded.mimeType) || getBaseMimeType(declaredMimeType) || "desconhecido";
      return { ok: false, status: 400, message: `Formato de áudio não suportado (${receivedType}).` };
    }

    const safeBaseName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.[^.]+$/, "") || "audio";
    const audioFile = new File([decoded.bytes], `${safeBaseName}.${audioFileType.extension}`, {
      type: audioFileType.mimeType,
    });
    const formData = new FormData();
    formData.append("model", "openai/gpt-4o-mini-transcribe");
    formData.append("file", audioFile);

    const res = await fetch(TRANSCRIPTION_URL, {
      method: "POST",
      headers: { "Lovable-API-Key": apiKey },
      body: formData,
    });
    if (!res.ok) {
      const detail = await readGatewayError(res);
      console.error("transcription failed:", res.status, detail);
      return {
        ok: false,
        status: res.status,
        message: detail || "O serviço de transcrição recusou o arquivo.",
      };
    }
    const data = await res.json();
    const text = sanitizeText(typeof data?.text === "string" ? data.text : "").trim();
    if (!text) {
      return { ok: false, status: 422, message: "Nenhuma fala foi identificada no áudio." };
    }
    return { ok: true, text };
  } catch (err) {
    console.error("transcription error:", err);
    return { ok: false, status: 502, message: "Falha ao conectar ao serviço de transcrição." };
  }
}

/** Remove caracteres de controle e blocos binários/base64 longos. */
function sanitizeText(value: string): string {
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/data:[a-z0-9/+.-]+;base64,[A-Za-z0-9+/=]+/gi, "")
    .replace(/\b[A-Za-z0-9+/]{200,}={0,2}\b/g, "");
}

/** Aplica a limpeza recursivamente em todo o objeto de dados do passo. */
function sanitizeDeep(value: unknown): unknown {
  if (typeof value === "string") return sanitizeText(value);
  if (Array.isArray(value)) return value.map(sanitizeDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, sanitizeDeep(v)]),
    );
  }
  return value;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const description: string = typeof body?.description === "string" ? body.description : "";
    const attachments: Attachment[] = Array.isArray(body?.attachments) ? body.attachments : [];

    if (!description.trim() && attachments.length === 0) {
      return json({ error: "Envie uma descrição ou um documento." }, 400);
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return json({ error: "LOVABLE_API_KEY não configurada." }, 500);

    // Monta o conteúdo multimodal da mensagem do usuário.
    const content: Record<string, unknown>[] = [];
    content.push({
      type: "text",
      text: description.trim()
        ? `Instruções do usuário:\n${description.trim()}`
        : "Compile o roteiro anexado em passos de fluxo, mantendo os textos literais.",
    });

    for (const att of attachments) {
      const mime = att.mimeType || "application/octet-stream";
      const baseMime = getBaseMimeType(mime);
      const kind = att.kind
        || (baseMime === "application/pdf" ? "pdf"
          : baseMime.startsWith("image/") ? "image"
          : baseMime.startsWith("audio/") || AUDIO_MIME_BY_EXTENSION[getFileExtension(att.name || "")] ? "audio" : "text");

      if (kind === "text" && att.text) {
        content.push({
          type: "text",
          text: `ROTEIRO — documento "${att.name || "anexo"}" (reproduza literalmente):\n<<<DOCUMENTO\n${att.text}\nDOCUMENTO>>>`,
        });
        continue;
      }

      if (!att.dataUrl) continue;

      if (kind === "pdf") {
        content.push({
          type: "file",
          file: { filename: att.name || "documento.pdf", file_data: att.dataUrl },
        });
      } else if (kind === "image") {
        content.push({ type: "image_url", image_url: { url: att.dataUrl } });
      } else if (kind === "audio") {
        // Áudio é transcrito em uma chamada dedicada ANTES da compilação.
        // Enviar o áudio junto com a instrução de compilar fazia o modelo
        // devolver trechos binários/base64 ("códigos") dentro das mensagens.
        const transcription = await transcribeAudio(
          att.dataUrl,
          att.name || "audio",
          mime,
          LOVABLE_API_KEY,
        );
        if (!transcription.ok) {
          const status = transcription.status === 429 || transcription.status === 402 || transcription.status === 403
            ? transcription.status
            : transcription.status >= 500 ? 502 : transcription.status;
          return json({
            error: `Não foi possível transcrever "${att.name || "anexo"}": ${transcription.message}`,
          }, status);
        }
        content.push({
          type: "text",
          text: `ROTEIRO — transcrição do áudio "${att.name || "anexo"}" (reproduza literalmente):\n<<<DOCUMENTO\n${transcription.text}\nDOCUMENTO>>>`,
        });
      }
    }


    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Lovable-API-Key": LOVABLE_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3.7-flash",
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await readGatewayError(response);
      console.error("AI gateway error:", response.status, detail);
      if (response.status === 429) {
        return json({ error: detail || "Limite de requisições excedido. Tente novamente em alguns segundos." }, 429);
      }
      if (response.status === 402) {
        return json({ error: detail || "Créditos de IA esgotados. Adicione créditos para continuar." }, 402);
      }
      if (response.status === 403) {
        return json({ error: detail || "A IA está bloqueada para este workspace." }, 403);
      }
      if (response.status === 400) {
        return json({ error: detail || "O documento enviado não pôde ser lido pelo modelo. Tente outro formato (PDF, DOCX ou TXT)." }, 400);
      }
      return json({ error: detail || "Falha na IA ao processar o documento." }, 502);
    }

    const result = await response.json();
    const raw: string = result?.choices?.[0]?.message?.content ?? "";

    let jsonStr = raw.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    }
    // Última rede de segurança: recorta o primeiro array JSON encontrado.
    if (!jsonStr.startsWith("[")) {
      const start = jsonStr.indexOf("[");
      const end = jsonStr.lastIndexOf("]");
      if (start !== -1 && end > start) jsonStr = jsonStr.slice(start, end + 1);
    }

    let steps: unknown;
    try {
      steps = JSON.parse(jsonStr);
    } catch {
      console.error("Invalid JSON from model:", jsonStr.slice(0, 500));
      return json({ error: "A IA retornou um formato inválido. Tente novamente." }, 502);
    }

    if (!Array.isArray(steps) || steps.length === 0) {
      return json({ error: "Nenhum passo foi identificado no documento." }, 422);
    }

    const normalized = steps
      .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
      .map((s) => ({
        type: typeof s.type === "string" ? s.type : "message",
        data: sanitizeDeep(s.data && typeof s.data === "object" ? s.data : {}) as Record<string, unknown>,
      }));


    return json({ steps: normalized });
  } catch (error) {
    console.error("generate-flow error:", error);
    return json({ error: error instanceof Error ? error.message : "Erro inesperado." }, 500);
  }
});
