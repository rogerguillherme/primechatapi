// Heuristic spam analyzer for WhatsApp templates (Anti-Ban v2 — Fase 1.2)
// Pure TS, no deps. Runs both in browser and Deno edge.

export type SpamRiskLevel = "low" | "medium" | "high" | "critical";

export interface SpamWarning {
  code: string;
  label: string;
  weight: number;
  detail?: string;
}

export interface SpamAnalysisResult {
  spam_score: number; // 0-100
  risk_level: SpamRiskLevel;
  warnings: SpamWarning[];
  domains: string[];
}

const TRIGGER_WORDS_PT = [
  "urgente", "imperdível", "imperdivel", "última chance", "ultima chance",
  "clique agora", "dinheiro rápido", "dinheiro rapido", "ganhe agora",
  "grátis", "gratis", "promoção relâmpago", "promocao relampago",
  "oferta exclusiva", "garantido", "100% garantido", "não perca",
  "nao perca", "aproveite agora", "compre já", "compre ja",
  "renda extra", "trabalhe em casa", "lucro garantido",
];

const TRIGGER_WORDS_EN = [
  "urgent", "act now", "click here", "click now", "free money",
  "guaranteed", "limited time", "buy now", "make money fast",
  "100% free", "risk free", "no obligation", "winner",
];

const ALL_TRIGGERS = [...TRIGGER_WORDS_PT, ...TRIGGER_WORDS_EN];

const URL_RE = /https?:\/\/[^\s]+/gi;
const EMOJI_RE = /[\u{1F300}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;

function extractDomains(text: string): string[] {
  const urls = text.match(URL_RE) || [];
  const domains: string[] = [];
  for (const u of urls) {
    try {
      domains.push(new URL(u).hostname.toLowerCase().replace(/^www\./, ""));
    } catch {
      // ignore malformed
    }
  }
  return domains;
}

export function analyzeTemplateContent(content: string): SpamAnalysisResult {
  const warnings: SpamWarning[] = [];
  const text = content || "";
  const trimmed = text.trim();
  const length = trimmed.length;

  // 1) CAPSLOCK ratio (letters only)
  const letters = trimmed.replace(/[^A-Za-zÀ-ÿ]/g, "");
  const upper = letters.replace(/[^A-ZÀ-Þ]/g, "");
  const capsRatio = letters.length > 0 ? upper.length / letters.length : 0;
  if (capsRatio > 0.5 && letters.length > 20) {
    warnings.push({
      code: "excess_caps",
      label: "Excesso de letras MAIÚSCULAS",
      weight: 18,
      detail: `${Math.round(capsRatio * 100)}% das letras estão em caixa alta`,
    });
  } else if (capsRatio > 0.35 && letters.length > 20) {
    warnings.push({
      code: "high_caps",
      label: "Muitas letras maiúsculas",
      weight: 8,
      detail: `${Math.round(capsRatio * 100)}% das letras estão em caixa alta`,
    });
  }

  // 2) Emoji ratio
  const emojis = trimmed.match(EMOJI_RE) || [];
  const emojiRatio = length > 0 ? emojis.length / Math.max(length / 10, 1) : 0;
  if (emojis.length > 8) {
    warnings.push({
      code: "excess_emojis",
      label: "Excesso de emojis",
      weight: 12,
      detail: `${emojis.length} emojis detectados`,
    });
  } else if (emojiRatio > 0.6 && emojis.length > 3) {
    warnings.push({
      code: "high_emoji_density",
      label: "Densidade alta de emojis",
      weight: 6,
    });
  }

  // 3) Trigger words
  const lower = trimmed.toLowerCase();
  const triggers = ALL_TRIGGERS.filter((w) => lower.includes(w));
  if (triggers.length > 0) {
    warnings.push({
      code: "trigger_words",
      label: "Palavras de risco para spam",
      weight: Math.min(8 * triggers.length, 32),
      detail: triggers.slice(0, 5).join(", "),
    });
  }

  // 4) Links
  const urls = trimmed.match(URL_RE) || [];
  if (urls.length > 3) {
    warnings.push({
      code: "many_links",
      label: "Muitos links",
      weight: 15,
      detail: `${urls.length} URLs no conteúdo`,
    });
  } else if (urls.length > 1) {
    warnings.push({
      code: "multi_link",
      label: "Mais de um link",
      weight: 6,
      detail: `${urls.length} URLs`,
    });
  }

  // 5) Domain repetition
  const domains = extractDomains(trimmed);
  const uniqueDomains = new Set(domains);
  if (domains.length > 2 && uniqueDomains.size === 1) {
    warnings.push({
      code: "domain_repetition",
      label: "Mesmo domínio repetido",
      weight: 10,
      detail: [...uniqueDomains][0],
    });
  }

  // 6) Length excessive
  if (length > 1024) {
    warnings.push({
      code: "excess_length",
      label: "Conteúdo muito longo",
      weight: 10,
      detail: `${length} caracteres`,
    });
  }

  // 7) Aggressive CTA (multiple !!!, ???, all-caps CTA tokens)
  if (/!{3,}|\?{3,}/.test(trimmed)) {
    warnings.push({
      code: "aggressive_punctuation",
      label: "Pontuação agressiva",
      weight: 8,
      detail: "Uso excessivo de ! ou ?",
    });
  }
  if (/\b(CLIQUE|COMPRE|GARANTA|APROVEITE|URGENTE)\b/.test(trimmed)) {
    warnings.push({
      code: "shouting_cta",
      label: "CTA em caixa alta",
      weight: 10,
    });
  }

  // Aggregate score
  const raw = warnings.reduce((acc, w) => acc + w.weight, 0);
  const spam_score = Math.min(100, Math.round(raw));

  let risk_level: SpamRiskLevel = "low";
  if (spam_score >= 85) risk_level = "critical";
  else if (spam_score >= 60) risk_level = "high";
  else if (spam_score >= 30) risk_level = "medium";

  return { spam_score, risk_level, warnings, domains: [...uniqueDomains] };
}

export function spamLevelColor(level: SpamRiskLevel): string {
  switch (level) {
    case "critical": return "destructive";
    case "high": return "destructive";
    case "medium": return "warning";
    default: return "secondary";
  }
}

export function spamLevelLabel(level: SpamRiskLevel): string {
  switch (level) {
    case "critical": return "Crítico";
    case "high": return "Alto";
    case "medium": return "Médio";
    default: return "Baixo";
  }
}
