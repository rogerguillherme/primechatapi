// Escolha de credencial do Meta CAPI: conta própria x secrets globais.
// Mesma regra tudo-ou-nada de pickMetritoCreds (metrito-map.mjs) — plano
// separado em .mjs pra caber no self-check em node puro (sem Deno).

export function pickCapiCreds(own, env) {
  const clean = (v) => {
    const s = typeof v === "string" ? v.trim() : "";
    return s || null;
  };
  const mine = {
    pixelId: clean(own?.pixelId),
    accessToken: clean(own?.accessToken),
    testEventCode: clean(own?.testEventCode),
  };
  const hasOwn = !!(mine.pixelId || mine.accessToken || mine.testEventCode);
  if (hasOwn) return mine;
  return {
    pixelId: clean(env?.pixelId),
    accessToken: clean(env?.accessToken),
    testEventCode: clean(env?.testEventCode),
  };
}
