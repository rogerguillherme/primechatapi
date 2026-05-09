import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GRAPH = "https://graph.facebook.com/v19.0";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { ig_user_id } = await req.json().catch(() => ({}));
    if (!ig_user_id) return json({ error: "ig_user_id é obrigatório" }, 400);

    const { data: conns } = await admin
      .from("instagram_connections")
      .select("user_access_token, user_token_expires_at")
      .eq("user_id", user.id)
      .not("user_access_token", "is", null)
      .order("updated_at", { ascending: false });

    const tokenRow = (conns || []).find((c: any) => c.user_access_token);
    if (!tokenRow?.user_access_token) {
      return json({ error: "Nenhum token Meta salvo. Reconecte o Instagram.", needs_reauth: true }, 404);
    }
    const userToken = tokenRow.user_access_token;

    const pagesRes = await fetch(
      `${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username,profile_picture_url,followers_count}&access_token=${userToken}`
    );
    const pagesData = await pagesRes.json();
    if (!pagesRes.ok) {
      return json({ error: pagesData?.error?.message || "Falha Meta", needs_reauth: true }, 401);
    }

    let igAccount: any = null;
    let pageInfo: any = null;
    for (const page of pagesData?.data || []) {
      if (page.instagram_business_account?.id === ig_user_id) {
        igAccount = page.instagram_business_account;
        pageInfo = page;
        break;
      }
    }
    if (!igAccount || !pageInfo) {
      return json({ error: "Conta IG não encontrada nas páginas autorizadas" }, 404);
    }

    let pageAccessToken = pageInfo.access_token;
    if (!pageAccessToken) {
      const r = await fetch(`${GRAPH}/${pageInfo.id}?fields=access_token&access_token=${userToken}`);
      const d = await r.json();
      pageAccessToken = d.access_token || userToken;
    }

    // Remove conexões antigas para o mesmo IG (mantém limpa)
    await admin
      .from("instagram_connections")
      .delete()
      .eq("user_id", user.id)
      .eq("instagram_user_id", igAccount.id);

    await admin.from("instagram_connections").insert({
      user_id: user.id,
      instagram_user_id: igAccount.id,
      instagram_username: igAccount.username,
      page_id: pageInfo.id,
      page_name: pageInfo.name,
      access_token: pageAccessToken,
      user_access_token: userToken,
      user_token_expires_at: tokenRow.user_token_expires_at,
      status: "connected",
    });

    // Subscribe webhooks
    try {
      await fetch(`${GRAPH}/${pageInfo.id}/subscribed_apps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscribed_fields: "messages,messaging_postbacks",
          access_token: pageAccessToken,
        }),
      });
      await fetch(`${GRAPH}/${igAccount.id}/subscribed_apps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscribed_fields: "comments",
          access_token: pageAccessToken,
        }),
      });
    } catch (e) {
      console.error("Webhook subscribe error:", e);
    }

    return json({
      ok: true,
      instagram_username: igAccount.username,
      instagram_user_id: igAccount.id,
      page_name: pageInfo.name,
    });
  } catch (e) {
    console.error("instagram-add-account error:", e);
    return json({ error: (e as Error).message || "Erro interno" }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
