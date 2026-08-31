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
          // "Internal Server Error" em texto puro não vem da nossa função: é o
          // Supabase respondendo por ela depois que o isolate morreu (estourou
          // tempo ou memória). Repassar essas duas palavras não diz nada a quem
          // está na tela, e manda procurar o erro no lugar errado.
          if (/^\s*internal server error\s*$/i.test(bruto)) {
            return "A função de envio não chegou a responder (tempo ou memória esgotados). Tente de novo; se repetir, é preciso olhar os logs da função.";
          }
          // Outro corpo não-JSON: o texto cru já ajuda mais que a mensagem padrão.
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
