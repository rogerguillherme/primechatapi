// Erros da Meta que valem para a CONTA INTEIRA, não para uma mensagem.
//
// A diferença importa: erro de mensagem se resolve reenviando, erro de conta
// não se resolve com nenhuma quantidade de tentativas. Tratar os dois igual faz
// o app insistir em algo que nunca vai passar — e cada insistência conta como
// entrega falhada, que é o número que a Meta usa para decidir banir.

const BLOQUEIOS = {
  "131031": "A conta comercial está travada pela Meta. Nada sai até isso ser resolvido no Business Suite — o recebimento continua funcionando.",
  "368": "A conta está temporariamente bloqueada por violação de políticas da Meta.",
  "131042": "A conta está com pendência de pagamento na Meta e não pode enviar.",
  "133000": "O número foi removido ou desregistrado na Meta.",
  "133004": "O número está indisponível na Meta no momento.",
};

/**
 * @param {string|number|null|undefined} code código de erro da Meta
 * @returns {string|null} explicação em português, ou null se não for bloqueio de conta
 */
export function bloqueioDeConta(code) {
  if (code === null || code === undefined) return null;
  return BLOQUEIOS[String(code).trim()] ?? null;
}
