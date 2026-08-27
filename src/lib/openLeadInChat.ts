/**
 * Chave de handoff entre uma tela de vendas e a aba de conversas.
 *
 * A navegação do app é por abas, e a aba de conversas guarda o lead
 * selecionado em estado próprio — não há rota nem parâmetro de URL para
 * apontar uma conversa. Como o Radix desmonta a aba inativa, ela lê esta
 * chave ao montar e a limpa em seguida.
 *
 * Passageiro de uma viagem só: se ninguém consumir, some no fim da sessão.
 */
export const OPEN_LEAD_KEY = "prime-chat:open-lead";

/** Lê e limpa o lead pendente. Retorna null quando não há nada a abrir. */
export function takePendingLead(): string | null {
  try {
    const id = sessionStorage.getItem(OPEN_LEAD_KEY);
    if (id) sessionStorage.removeItem(OPEN_LEAD_KEY);
    return id;
  } catch {
    // Navegador com armazenamento bloqueado: sem handoff, mas sem quebrar.
    return null;
  }
}
