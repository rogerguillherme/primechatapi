// Confere um segredo compartilhado em webhooks que não assinam o payload
// (Hubla, Z-API, Evolution, 360dialog) — sem isso, qualquer um na internet
// pode forjar um POST pra essas rotas (elas rodam com verify_jwt=false).
// O segredo pode vir como sufixo da URL (.../nome-da-funcao/<secret>) ou
// no header x-webhook-secret. Falha fechado se a env var não existir.
export function checkWebhookSecret(req: Request, envVarName: string): boolean {
  const expected = Deno.env.get(envVarName);
  if (!expected) return false;

  const url = new URL(req.url);
  const pathToken = url.pathname.split("/").filter(Boolean).pop();
  const headerToken = req.headers.get("x-webhook-secret");
  const queryToken = url.searchParams.get("secret");

  return pathToken === expected || headerToken === expected || queryToken === expected;
}
