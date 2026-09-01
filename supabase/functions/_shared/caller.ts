// Quem está chamando esta função.
//
// `verify_jwt = true` não é autenticação: ele só confere que o token é válido,
// e a anon key é um token válido — ela vai no bundle do front, é pública por
// construção. Qualquer função que use a service role e escolha a conta pelo
// CORPO da requisição está, sem isto, aberta para qualquer pessoa operar a
// conta de qualquer cliente.
//
// Duas origens legítimas: o encadeamento interno (cron, fluxo, outra função,
// que usa a service role) e uma pessoa logada agindo sobre a própria conta.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface Caller {
  /** Chamada de dentro (cron/fluxo/função) com a service role. */
  interno: boolean;
  /** Usuário autenticado, quando houver. */
  userId: string | null;
}

export async function identificarChamador(req: Request): Promise<Caller> {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (serviceKey && token === serviceKey) return { interno: true, userId: null };

  if (!token) return { interno: false, userId: null };

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  // A anon key é um JWT válido e não identifica ninguém: descartar aqui evita
  // tratar "sem login" como se fosse alguém.
  if (anonKey && token === anonKey) return { interno: false, userId: null };

  try {
    const client = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data } = await client.auth.getUser();
    return { interno: false, userId: data?.user?.id ?? null };
  } catch {
    return { interno: false, userId: null };
  }
}

/**
 * A conta pertence a quem está chamando? Chamada interna passa direto — ela
 * já é o próprio sistema agindo.
 */
export async function contaPertenceAoChamador(
  admin: { from: (t: string) => any },
  caller: Caller,
  accountId: string,
): Promise<boolean> {
  if (caller.interno) return true;
  if (!caller.userId || !accountId) return false;
  const { data } = await admin
    .from("whatsapp_accounts")
    .select("id")
    .eq("id", accountId)
    .eq("user_id", caller.userId)
    .maybeSingle();
  return !!data;
}
