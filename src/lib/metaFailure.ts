/**
 * Traduz a falha ASSÍNCRONA da Meta que chega pelo webhook de status.
 *
 * Essa falha é diferente da recusa no envio: ali a função responde na hora e
 * já explica em português. Aqui a Meta aceitou a chamada (HTTP 200), a bolha
 * ficou verde, e minutos depois ela avisa que não entregou. O motivo vem em
 * inglês, curto e repetido ("Message undeliverable: Message Undeliverable."),
 * e era mostrado cru ao lado da mensagem.
 */
const MOTIVOS: Record<string, string> = {
  // O caso mais comum no Brasil: o número guardado não é o que a Meta usa para
  // rotear — quase sempre o nono dígito sobrando ou faltando. A conversa recebe
  // normalmente e nenhuma resposta chega.
  "131026":
    "A Meta não conseguiu entregar. Quase sempre é o número do contato com o nono dígito a mais ou a menos — quando ele responder, o número se corrige sozinho. Também acontece se o aparelho dele estiver com WhatsApp muito antigo.",
  "131047":
    "Passaram-se mais de 24 horas desde a última mensagem do contato. Só um template aprovado reabre a conversa.",
  "131049":
    "A Meta segurou a entrega para preservar a experiência do usuário. Espere um pouco e evite enviar em sequência para o mesmo contato.",
  "131051": "Tipo de mensagem não suportado por este contato.",
  "130472":
    "O contato está em um experimento da Meta e não recebe mensagens de marketing agora.",
  "131000": "Erro temporário da Meta na entrega. Reenvie.",
};

/**
 * @param code  error_code gravado pelo webhook (vem como texto)
 * @param title error_title da Meta, usado quando o código é desconhecido
 * @param details error_details da Meta
 */
export function metaFailureMessage(
  code?: string | null,
  title?: string | null,
  details?: string | null,
): string {
  const conhecido = code ? MOTIVOS[String(code).trim()] : undefined;
  if (conhecido) return conhecido;

  // Código desconhecido: a Meta costuma repetir a mesma frase em title e
  // details ("Message undeliverable" / "Message Undeliverable."). Mostrar as
  // duas só ocupa espaço.
  const t = (title || "").trim();
  const d = (details || "").trim();
  const mesmaCoisa = t && d && t.toLowerCase().replace(/\.$/, "") === d.toLowerCase().replace(/\.$/, "");
  const texto = mesmaCoisa ? t : [t, d].filter(Boolean).join(": ");
  return texto || "Falha no envio";
}
