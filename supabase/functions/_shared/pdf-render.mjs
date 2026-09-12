// Gera um PDF simples (título + corpo em parágrafos) a partir de texto puro.
//
// Por quê pdf-lib e não um HTML->PDF de verdade: Supabase Edge Functions não
// roda um navegador headless (nem Chromium, nem nada que precise de um
// processo/binário nativo) — pdf-lib é JS puro, roda dentro do próprio Deno
// da function, sem depender de nenhum serviço externo. Em troca, o layout é
// desenhado à mão aqui (sem CSS) — mais simples que um template HTML, mas
// funciona 100% dentro do sistema.
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";

const PAGE_WIDTH = 595.28; // A4 em pontos
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const BAR_COLOR = rgb(0.18, 0.42, 0.68); // azul discreto, neutro o bastante pra qualquer marca

/**
 * O editor de PDF do fluxo permite colar um documento HTML inteiro. Sem esta
 * conversão o PDF sairia com o código-fonte (`<!DOCTYPE html> ... <style>`) e,
 * pior, o `drawText` estourava em qualquer caractere fora do WinAnsi (emoji),
 * caindo no fallback de texto — foi assim que o "mapa do lipedema" virou uma
 * mensagem de 38 mil caracteres que a Meta recusou (limite de 4096).
 */
export function htmlToPlainText(input) {
  let s = String(input || "");
  if (!/<[a-z!/][\s\S]*>/i.test(s)) return s;

  s = s
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|table|header|footer)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "");

  const entidades = {
    nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
    hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘",
    ldquo: "“", rdquo: "”", eacute: "é", aacute: "á", ccedil: "ç",
  };
  s = s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => entidades[name.toLowerCase()] ?? m);

  return s
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Remove o que as fontes padrão do PDF (WinAnsi) não conseguem escrever.
 * Emoji vira nada; qualquer outro caractere fora da tabela vira "?" — melhor
 * um caractere trocado do que o PDF inteiro falhar.
 */
export function sanitizeForWinAnsi(text) {
  return String(text || "")
    .replace(/\p{Extended_Pictographic}|[\u{1F000}-\u{1FAFF}\u{FE00}-\u{FE0F}\u{200D}]/gu, "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[^\x09\x0A\x20-\x7E\u00A0-\u00FF\u20AC]/g, "?");
}

/** Quebra uma linha longa em várias que cabem em `maxWidth`, sem cortar palavra. */
function wrapLine(line, font, size, maxWidth) {
  const words = line.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const out = [];
  let current = words[0];
  for (const word of words.slice(1)) {
    const attempt = `${current} ${word}`;
    if (font.widthOfTextAtSize(attempt, size) <= maxWidth) {
      current = attempt;
    } else {
      out.push(current);
      current = word;
    }
  }
  out.push(current);
  return out;
}

/**
 * Renderiza texto simples em PDF: 1ª linha não-vazia vira título, o resto
 * vira corpo (parágrafos separados por linha em branco preservam o espaço
 * entre eles). Quebra página automaticamente quando o conteúdo não cabe.
 */
export async function renderTextToPdf(rawText) {
  const plain = sanitizeForWinAnsi(htmlToPlainText(rawText));
  const lines = plain.replace(/\r\n/g, "\n").split("\n");
  const firstContentIdx = lines.findIndex((l) => l.trim());
  const title = firstContentIdx >= 0 ? lines[firstContentIdx].trim() : "";
  const bodyLines = firstContentIdx >= 0 ? lines.slice(firstContentIdx + 1) : [];

  const pdf = await PDFDocument.create();
  const fontRegular = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const maxWidth = PAGE_WIDTH - MARGIN * 2;
  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const newPage = () => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  };

  // Barra de cor no topo — único toque visual, sem exigir CSS/imagem.
  page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 10, width: PAGE_WIDTH, height: 10, color: BAR_COLOR });
  y -= 12;

  if (title) {
    const titleSize = 20;
    for (const wrapped of wrapLine(title, fontBold, titleSize, maxWidth)) {
      if (y < MARGIN + titleSize) newPage();
      page.drawText(wrapped, { x: MARGIN, y: y - titleSize, size: titleSize, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
      y -= titleSize + 6;
    }
    y -= 10;
  }

  const bodySize = 12;
  const lineHeight = bodySize * 1.4;
  for (const paragraph of bodyLines) {
    if (!paragraph.trim()) {
      y -= lineHeight * 0.6; // linha em branco = espaço entre parágrafos
      continue;
    }
    for (const wrapped of wrapLine(paragraph, fontRegular, bodySize, maxWidth)) {
      if (y < MARGIN + lineHeight) newPage();
      page.drawText(wrapped, { x: MARGIN, y: y - bodySize, size: bodySize, font: fontRegular, color: rgb(0.15, 0.15, 0.15) });
      y -= lineHeight;
    }
  }

  return await pdf.save();
}
