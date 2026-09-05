/**
 * Extração de conteúdo de documentos para o importador de fluxo com IA.
 *
 * Estratégia (defensiva, por camadas):
 *  1. Formatos de texto puro (txt, md, csv, json, html, xml, vtt, srt) → leitura direta.
 *  2. DOCX / ODT / PPTX → descompactação ZIP e extração do XML interno (jszip).
 *  3. XLS / XLSX → conversão de cada planilha em CSV (biblioteca xlsx).
 *  4. PDF / imagens / áudio → enviados inline (base64) para o modelo multimodal.
 *
 * O objetivo é sempre entregar ao modelo o conteúdo LITERAL do documento,
 * pois o importador deve reproduzir o roteiro exatamente como escrito.
 */

export interface ExtractedAttachment {
  name: string;
  mimeType: string;
  /** Texto extraído no cliente (quando possível). */
  text?: string;
  /** Data URL base64 para envio multimodal (PDF, imagem, áudio). */
  dataUrl?: string;
  /** Categoria usada pela Edge Function para montar o bloco correto. */
  kind: "text" | "pdf" | "image" | "audio";
}

/** Extensões aceitas pelo seletor de arquivos. */
export const ACCEPTED_FLOW_DOC_EXTENSIONS = [
  ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".html", ".htm", ".xml",
  ".vtt", ".srt", ".rtf", ".log", ".yaml", ".yml",
  ".docx", ".odt", ".pptx",
  ".xls", ".xlsx",
  ".pdf",
  ".png", ".jpg", ".jpeg", ".webp", ".gif",
  ".mp3", ".m4a", ".ogg", ".wav", ".webm", ".aac", ".flac",
] as const;

export const ACCEPT_ATTR = ACCEPTED_FLOW_DOC_EXTENSIONS.join(",");

/** 20 MB — limite de upload prático para leitura no navegador. */
export const MAX_DOC_BYTES = 20 * 1024 * 1024;

const TEXT_EXT = new Set([
  "txt", "md", "markdown", "csv", "tsv", "json", "html", "htm", "xml",
  "vtt", "srt", "log", "yaml", "yml", "rtf",
]);
const ZIP_XML_EXT = new Set(["docx", "odt", "pptx"]);
const SHEET_EXT = new Set(["xls", "xlsx", "xlsm"]);
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
const AUDIO_EXT = new Set(["mp3", "m4a", "ogg", "wav", "webm", "aac", "flac"]);

const extOf = (name: string): string => {
  const idx = name.lastIndexOf(".");
  return idx === -1 ? "" : name.slice(idx + 1).toLowerCase();
};

const readAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Falha ao ler o arquivo."));
    reader.readAsDataURL(file);
  });

const stripXmlToText = (xml: string): string =>
  xml
    // Preserva quebras de parágrafo/linha antes de remover as tags.
    .replace(/<\/w:p>|<\/text:p>|<\/a:p>|<w:br\s*\/>/g, "\n")
    .replace(/<\/w:tab>|<w:tab\s*\/>/g, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#\d+;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

async function extractZipXmlText(file: File, ext: string): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());

  const targets: string[] = [];
  if (ext === "docx") targets.push("word/document.xml");
  if (ext === "odt") targets.push("content.xml");
  if (ext === "pptx") {
    zip.forEach((path) => {
      if (/^ppt\/slides\/slide\d+\.xml$/.test(path)) targets.push(path);
    });
    targets.sort((a, b) => {
      const n = (s: string) => Number(s.match(/slide(\d+)\.xml/)?.[1] ?? 0);
      return n(a) - n(b);
    });
  }

  const parts: string[] = [];
  for (const path of targets) {
    const entry = zip.file(path);
    if (!entry) continue;
    parts.push(stripXmlToText(await entry.async("string")));
  }

  const text = parts.filter(Boolean).join("\n\n");
  if (!text) throw new Error("Não foi possível extrair texto deste documento.");
  return text;
}

async function extractSheetText(file: File): Promise<string> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const parts = wb.SheetNames.map((sheetName) => {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sheetName]);
    return `# ${sheetName}\n${csv}`;
  });
  const text = parts.join("\n\n").trim();
  if (!text) throw new Error("Planilha vazia.");
  return text;
}

/** Converte um arquivo em conteúdo consumível pelo modelo. */
export async function extractFlowDocument(file: File): Promise<ExtractedAttachment> {
  if (file.size === 0) throw new Error("Arquivo vazio.");
  if (file.size > MAX_DOC_BYTES) {
    throw new Error("Arquivo acima de 20MB. Envie uma versão menor.");
  }

  const ext = extOf(file.name);
  const mimeType = file.type || "application/octet-stream";

  if (TEXT_EXT.has(ext) || mimeType.startsWith("text/")) {
    const text = await file.text();
    if (!text.trim()) throw new Error("O documento não contém texto.");
    return { name: file.name, mimeType: mimeType || "text/plain", text, kind: "text" };
  }

  if (ZIP_XML_EXT.has(ext)) {
    return { name: file.name, mimeType, text: await extractZipXmlText(file, ext), kind: "text" };
  }

  if (SHEET_EXT.has(ext)) {
    return { name: file.name, mimeType, text: await extractSheetText(file), kind: "text" };
  }

  if (ext === "pdf" || mimeType === "application/pdf") {
    return { name: file.name, mimeType: "application/pdf", dataUrl: await readAsDataUrl(file), kind: "pdf" };
  }

  if (IMAGE_EXT.has(ext) || mimeType.startsWith("image/")) {
    return { name: file.name, mimeType, dataUrl: await readAsDataUrl(file), kind: "image" };
  }

  if (AUDIO_EXT.has(ext) || mimeType.startsWith("audio/")) {
    return { name: file.name, mimeType, dataUrl: await readAsDataUrl(file), kind: "audio" };
  }

  throw new Error(`Formato não suportado: ${file.name}`);
}
