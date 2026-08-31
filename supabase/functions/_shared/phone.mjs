// Número de telefone vindo de webhook de WhatsApp.
//
// Duas suposições de "todo mundo é brasileiro" já quebraram envio aqui, as
// duas em silêncio — a Graph aceita, a entrega falha depois com 131026, e a
// tela não diz nada. Por isso isto vive fora do handler, com teste.

/**
 * O wa_id da Meta (e o JID da Evolution) SEMPRE trazem o código do país.
 * Não há o que deduzir: só tirar a pontuação.
 */
export function normalizeWaId(phone) {
  return String(phone || "").replace(/\D/g, "");
}

/**
 * Formas sob as quais o mesmo contato pode estar gravado.
 *
 * Brasil alterna o nono dígito, e é o único caso em que inventar um dígito faz
 * sentido — fazer isso com um número de Portugal produz um destino inexistente.
 * Para os estrangeiros incluímos a forma corrompida do passado (55 grudado na
 * frente) só para ACHAR o lead antigo e poder consertá-lo.
 */
export function phoneVariants(phone) {
  const digits = normalizeWaId(phone);
  if (!digits) return [];
  if (!digits.startsWith("55")) return [digits, "55" + digits];

  const variants = [digits];
  const afterCountry = digits.slice(2); // DDD + número
  if (afterCountry.length === 11 && afterCountry[2] === "9") {
    variants.push("55" + afterCountry.slice(0, 2) + afterCountry.slice(3));
  } else if (afterCountry.length === 10) {
    variants.push("55" + afterCountry.slice(0, 2) + "9" + afterCountry.slice(2));
  }
  return variants;
}
