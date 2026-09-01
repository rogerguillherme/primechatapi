// De quem é o lead que está entrando.
//
// Integração de instância única — Z-API e Hubla — não diz a qual cliente o
// contato pertence: a credencial é global, uma só para a plataforma inteira.
// Os dois criavam o lead sem `user_id`, e lead órfão não é neutro: a busca por
// telefone deixa de ser isolada por dono, então a conversa de um cliente passa
// a poder cair no CRM de outro, e as políticas de acesso não enxergam a linha.
//
// A saída é dizer o dono de forma explícita, uma vez, em app_settings.

/**
 * Herda o dono de um lead que já exista com o mesmo telefone/e-mail; se não
 * houver, usa o dono configurado para a integração.
 *
 * @param chave chave em app_settings com o user_id dono da integração
 *              (ex.: "zapi_owner_user_id", "hubla_owner_user_id")
 */
export async function donoDaIntegracao(
  admin: { from: (t: string) => any },
  chave: string,
  pistas: { telefones?: string[]; email?: string | null },
): Promise<string | null> {
  const telefones = (pistas.telefones || []).filter(Boolean);
  if (telefones.length) {
    const { data } = await admin
      .from("leads")
      .select("user_id")
      .in("phone", telefones)
      .not("user_id", "is", null)
      .limit(1)
      .maybeSingle();
    if (data?.user_id) return data.user_id as string;
  }

  if (pistas.email) {
    const { data } = await admin
      .from("leads")
      .select("user_id")
      .eq("email", pistas.email)
      .not("user_id", "is", null)
      .limit(1)
      .maybeSingle();
    if (data?.user_id) return data.user_id as string;
  }

  const { data: cfg } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", chave)
    .maybeSingle();
  const configurado = (cfg?.value || "").trim();
  return configurado || null;
}
