// Utilidades compartilhadas para casar a resposta do lead com os ramos de um fluxo
// e para aplicar etiquetas (tags) nos passos por onde o lead passa.
//
// Modos de comparação suportados em `flow_steps.match_mode`:
//   - "exact"    → texto normalizado precisa ser idêntico a uma das palavras-chave
//   - "contains" → aceita conter a palavra-chave ou ser muito parecida (typo-tolerante)
//   - "ai"       → a IA avalia se a resposta corresponde à intenção descrita

/** Remove acentos, pontuação e espaços extras; retorna minúsculas. */
export function normalizeText(value: string | null | undefined): string {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function expandKeywords(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,\n;|]/)
    .map((v) => normalizeText(v))
    .filter(Boolean);
}

/** Distância de Levenshtein (iterativa, O(n*m)) para tolerar erros de digitação. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    const curr = new Array(b.length + 1);
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[b.length];
}

/** true quando as strings são "parecidas" o suficiente (>= ~80% de similaridade). */
export function isSimilar(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const maxLen = Math.max(a.length, b.length);
  // Palavras muito curtas não toleram erro: "sim" vs "nao" não pode casar.
  const allowed = maxLen <= 4 ? 0 : maxLen <= 8 ? 1 : Math.floor(maxLen * 0.2);
  return levenshtein(a, b) <= allowed;
}

/** Comparação "parecida": contém a palavra-chave ou é aproximada por palavra. */
export function looseMatch(reply: string, keyword: string): boolean {
  const r = normalizeText(reply);
  const k = normalizeText(keyword);
  if (!r || !k) return false;
  if (r === k) return true;
  if (r.includes(k) || k.includes(r)) return true;
  if (isSimilar(r, k)) return true;

  const replyWords = r.split(" ");
  const keywordWords = k.split(" ");
  if (keywordWords.length === 1) {
    return replyWords.some((w) => isSimilar(w, k));
  }
  // Frase-chave: exige que a maioria das palavras esteja presente (aproximadamente).
  const hits = keywordWords.filter((kw) => replyWords.some((w) => isSimilar(w, kw))).length;
  return hits >= Math.ceil(keywordWords.length * 0.7);
}

export function matchesStep(step: any, replyCandidates: string[]): boolean {
  const keywords = expandKeywords(step?.trigger_value);
  if (keywords.length === 0) return false;
  const mode = step?.match_mode || "exact";
  const normalizedReplies = replyCandidates.map((c) => normalizeText(c)).filter(Boolean);
  if (normalizedReplies.length === 0) return false;

  if (mode === "exact") {
    return keywords.some((k) => normalizedReplies.includes(k));
  }
  // "contains" e "ai" também aceitam o casamento aproximado local
  // (na IA isso evita uma chamada desnecessária quando já é claramente igual).
  return keywords.some((k) => normalizedReplies.some((r) => looseMatch(r, k)));
}

/**
 * Avaliação por IA: decide se a resposta do lead corresponde à intenção do ramo.
 * Retorna false em qualquer falha (nunca deixa o fluxo travado por erro de IA).
 */
export async function aiMatchesStep(step: any, replyText: string): Promise<boolean> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey || !replyText?.trim()) return false;

  const keywords = expandKeywords(step?.trigger_value);
  const description = (step?.ai_match_description || "").trim();

  const prompt = [
    "Você avalia se a resposta de um cliente corresponde à intenção esperada em um fluxo de atendimento.",
    description ? `Intenção esperada: ${description}` : "",
    keywords.length ? `Exemplos de respostas equivalentes: ${keywords.join(", ")}` : "",
    `Resposta do cliente: "${replyText.slice(0, 500)}"`,
    'Responda APENAS com JSON: {"match": true} ou {"match": false}.',
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      // 402/403 = créditos/política; 429/5xx = transitório. Em todos os casos,
      // não travamos o fluxo: apenas registramos e caímos no casamento local.
      console.error("AI match request failed:", res.status, (await res.text()).slice(0, 300));
      return false;
    }

    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content || "";
    try {
      const parsed = JSON.parse(content);
      return parsed?.match === true;
    } catch {
      return /true/i.test(content);
    }
  } catch (err) {
    console.error("AI match error:", err);
    return false;
  }
}

/** Aplica as etiquetas configuradas no passo ao lead (idempotente). */
export async function applyStepLabels(supabase: any, step: any, leadId: string | null | undefined) {
  const labelIds: string[] = Array.isArray(step?.label_ids) ? step.label_ids : [];
  if (!leadId || labelIds.length === 0) return;

  for (const labelId of labelIds) {
    try {
      const { data: existing } = await supabase
        .from("lead_labels")
        .select("id")
        .eq("lead_id", leadId)
        .eq("label_id", labelId)
        .maybeSingle();
      if (existing) continue;
      await supabase.from("lead_labels").insert({ lead_id: leadId, label_id: labelId });
    } catch (err) {
      console.error("Failed to apply flow step label:", labelId, err);
    }
  }
}
