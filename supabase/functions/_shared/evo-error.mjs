// Desembrulha a mensagem de erro real da Evolution API.
//
// A Evolution responde assim quando algo dá errado:
//   { "status": 500, "error": "Internal Server Error",
//     "response": { "message": ["Connection Closed"] } }
//
// Ler só `error` devolve "Internal Server Error" — um rótulo de categoria, não
// a causa. Foi o que o chat mostrou no lead Kauã: o motivo verdadeiro estava
// ali dentro, em `response.message`, e era jogado fora antes de chegar na tela.

/** Achata uma mensagem que pode vir como string, array, ou array de objetos. */
function texto(m) {
  if (!m) return "";
  if (typeof m === "string") return m.trim();
  if (Array.isArray(m)) return m.map(texto).filter(Boolean).join(" · ");
  if (typeof m === "object") {
    // Ex.: [{ exists: false, number: "5511..." }] na checagem de número.
    if (m.exists === false && m.number) return `o número ${m.number} não tem WhatsApp`;
    if (m.message) return texto(m.message);
    return Object.entries(m).map(([k, v]) => `${k}: ${texto(v) || v}`).join(", ");
  }
  return String(m);
}

/**
 * @param {any} data corpo da resposta já parseado (ou { raw: "..." })
 * @param {number} status HTTP status devolvido pela Evolution
 * @returns {string} a frase mais específica disponível
 */
export function evoErrorMessage(data, status) {
  const generico = `Falha no envio via Evolution API (HTTP ${status}).`;
  if (!data) return generico;
  if (typeof data === "string") return data.trim() || generico;

  // Ordem: do mais específico para o mais genérico.
  const especifico =
    texto(data?.response?.message) ||
    texto(data?.message) ||
    texto(data?.response) ||
    texto(data?.raw);

  const rotulo = typeof data?.error === "string" ? data.error.trim() : "";

  if (especifico && rotulo && especifico !== rotulo) return `${rotulo}: ${especifico}`;
  return especifico || rotulo || generico;
}
