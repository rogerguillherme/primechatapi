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

/**
 * Telefone digitado por uma pessoa — checkout, importação, cadastro manual.
 *
 * Aqui, ao contrário do wa_id, o DDI pode faltar de verdade: um checkout
 * brasileiro costuma guardar "11987654321". Mas grudar 55 em tudo que não
 * começa com 55 corrompe todo número estrangeiro — foi assim que um contato
 * de Portugal virou 55351927092084 e parou de receber.
 *
 * O comprimento resolve sem tabela de países: número nacional brasileiro tem
 * 10 ou 11 dígitos (DDD + 8 ou 9). Qualquer outro comprimento já carrega DDI,
 * e a única coisa certa a fazer é não mexer.
 */
export function normalizeTypedPhone(phone) {
  const d = normalizeWaId(phone);
  if (d.length === 10 || d.length === 11) return "55" + d;
  return d;
}

/**
 * O número tem cara de número?
 *
 * Mandar para número que não existe no WhatsApp é um dos sinais que a Meta usa
 * para medir qualidade da conta — e conta com qualidade baixa é banida. O app
 * vinha corrompendo números (código de país duplicado, nono dígito trocado) e
 * cada um desses virava uma entrega falhada contando contra a conta.
 *
 * Isto não substitui a validação da Meta: só barra o que é impossível, para
 * que erro nosso pare de virar estatística ruim. E-164 permite no máximo 15
 * dígitos; abaixo de 8 não existe número internacional discável.
 */
export function telefoneImplausivel(phone) {
  const d = normalizeWaId(phone);
  if (d.length < 8) return `número curto demais (${d.length} dígitos)`;
  if (d.length > 15) return `número longo demais (${d.length} dígitos)`;
  // Brasil: 55 + DDD(2) + 8 ou 9 dígitos = 12 ou 13. Mais que isso é código de
  // país duplicado, que foi exatamente o defeito encontrado.
  if (d.startsWith("55") && d.length > 13) {
    return `número com ${d.length} dígitos começando em 55 — provável código de país duplicado`;
  }
  return null;
}
