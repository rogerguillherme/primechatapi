// Grava o App ID/Secret do app Meta próprio de uma conta.
//
// Mesmo raciocínio do metrik-credentials: a gravação sai do navegador de
// propósito — quem escreve é a função, com service role, depois de conferir
// quem pediu e se é dono/gerente da conta. app_secret nunca volta na
// resposta (a tabela também bloqueia isso via GRANT por coluna, mas a função
// não devolve mesmo se alguém tirar essa trava por engano).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { identificarChamador } from "../_shared/caller.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const chamador = await identificarChamador(req);
    if (!chamador.userId) return json({ error: "Não autenticado" }, 401);

    const body = await req.json().catch(() => ({}));
    const appId = String(body?.app_id || "").trim();
    const appSecret = String(body?.app_secret || "").trim();
    if (!appId || !appSecret) return json({ error: "Informe App ID e App Secret" }, 400);
    if (!/^\d+$/.test(appId)) return json({ error: "App ID deve conter só números" }, 400);

    // De quem é a conta: o próprio usuário, ou o dono de quem ele é membro.
    const { data: vinculo } = await admin
      .from("team_members")
      .select("owner_id, access_level")
      .eq("member_user_id", chamador.userId)
      .order("created_at")
      .limit(1)
      .maybeSingle();

    const ownerId = vinculo?.owner_id ?? chamador.userId;
    const nivel = vinculo ? vinculo.access_level : "owner";

    // Credencial de app abre conexão OAuth da conta inteira. Só quem manda.
    if (!["owner", "manager"].includes(String(nivel))) {
      return json({ error: "Só dono e gerente cadastram o app Meta" }, 403);
    }

    const agora = new Date().toISOString();
    const { error } = await admin.from("meta_apps").upsert(
      { owner_id: ownerId, app_id: appId, app_secret: appSecret, updated_at: agora },
      { onConflict: "owner_id" },
    );
    if (error) return json({ error: error.message }, 500);

    return json({ ok: true, app_id: appId, configured_at: agora });
  } catch (e) {
    console.error("meta-app-credentials:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
