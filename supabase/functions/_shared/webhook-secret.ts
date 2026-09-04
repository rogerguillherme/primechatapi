// Confere um segredo compartilhado em webhooks que não assinam o payload
// (Hubla, Z-API, Evolution, 360dialog) — sem isso, qualquer um na internet
// pode forjar um POST pra essas rotas (elas rodam com verify_jwt=false).
// O segredo pode vir como sufixo da URL (.../nome-da-funcao/<secret>) ou
// no header x-webhook-secret. Falha fechado se o valor esperado não existir.
function matchesSecret(req: Request, expected: string | null | undefined): boolean {
  if (!expected) return false;

  const url = new URL(req.url);
  const pathToken = url.pathname.split("/").filter(Boolean).pop();
  const headerToken = req.headers.get("x-webhook-secret");
  const queryToken = url.searchParams.get("secret");

  return pathToken === expected || headerToken === expected || queryToken === expected;
}

export function checkWebhookSecret(req: Request, envVarName: string): boolean {
  return matchesSecret(req, Deno.env.get(envVarName));
}

/** Mesma checagem, mas com o segredo já resolvido (ex.: por conta, vindo do banco). */
export function checkWebhookSecretValue(req: Request, expected: string | null | undefined): boolean {
  return matchesSecret(req, expected);
}
