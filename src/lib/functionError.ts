/**
 * Extrai o motivo real de uma falha de edge function.
 *
 * `supabase.functions.invoke` devolve, em qualquer resposta não-2xx, um erro
 * genérico: "Edge Function returned a non-2xx status code". O motivo de
 * verdade vem no corpo, e era descartado — foi por isso que uma falha de envio
 * de áudio, que a própria função explicava em detalhe, chegava ao operador
 * como "não está funcionando".
 */
export async function functionErrorMessage(
  err: unknown,
  fallback = "Não foi possível concluir a operação",
): Promise<string> {
  const ctx = (err as { context?: unknown })?.context;

  // FunctionsHttpError carrega a Response original em `context`.
  if (ctx && typeof (ctx as Response).text === "function") {
    try {
      const bruto = await (ctx as Response).clone().text();
      if (bruto) {
        try {
          const json = JSON.parse(bruto);
          const msg = json?.error || json?.message;
          if (typeof msg === "string" && msg.trim()) return msg;
        } catch {
          // Corpo não era JSON: o texto cru já ajuda mais que a mensagem padrão.
          return bruto.slice(0, 300);
        }
      }
    } catch {
      /* corpo já consumido ou indisponível */
    }
  }

  const msg = (err as { message?: string })?.message;
  return msg && !msg.includes("non-2xx") ? msg : fallback;
}
