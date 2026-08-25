import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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

const AUDIO_EXTENSIONS: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
  "audio/aac": "aac",
  "audio/flac": "flac",
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

type TranscriptionResult =
  | { ok: true; text: string }
  | { ok: false; status: number; message: string };

function decodeAudioDataUrl(dataUrl: string): { bytes: Uint8Array; mimeType: string } | null {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!match) return null;

  try {
    const binary = atob(match[2].replace(/\s/g, ""));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return { bytes, mimeType: match[1].toLowerCase() };
  } catch {
    return null;
  }
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

    const mimeType = decoded.mimeType.startsWith("audio/")
      ? decoded.mimeType
      : declaredMimeType.split(";")[0].toLowerCase();
    const extension = AUDIO_EXTENSIONS[mimeType];
    if (!extension) {
      return { ok: false, status: 400, message: `Formato de áudio não suportado (${mimeType}).` };
    }

    const safeBaseName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.[^.]+$/, "") || "audio";
    const audioFile = new File([decoded.bytes], `${safeBaseName}.${extension}`, { type: mimeType });
    const formData = new FormData();
    formData.append("model", "openai/gpt-4o-mini-transcribe");
    formData.append("file", audioFile);

    const res = await fetch(TRANSCRIPTION_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 500);
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
      const kind = att.kind
        || (mime === "application/pdf" ? "pdf"
          : mime.startsWith("image/") ? "image"
          : mime.startsWith("audio/") ? "audio" : "text");

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
      const detail = await response.text();
      console.error("AI gateway error:", response.status, detail);
      if (response.status === 429) {
        return json({ error: "Limite de requisições excedido. Tente novamente em alguns segundos." }, 429);
      }
      if (response.status === 402) {
        return json({ error: "Créditos de IA esgotados. Adicione créditos para continuar." }, 402);
      }
      if (response.status === 400) {
        return json({ error: "O documento enviado não pôde ser lido pelo modelo. Tente outro formato (PDF, DOCX ou TXT)." }, 400);
      }
      return json({ error: "Falha na IA ao processar o documento." }, 502);
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
      .filter((s): s is Record<string, any> => !!s && typeof s === "object")
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
