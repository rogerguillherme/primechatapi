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

    // Pega a conexão mais recente com user_access_token salvo
    const { data: conns } = await admin
      .from("instagram_connections")
      .select("user_access_token, user_token_expires_at, instagram_user_id")
      .eq("user_id", user.id)
      .not("user_access_token", "is", null)
      .order("updated_at", { ascending: false });

    const tokenRow = (conns || []).find((c: any) => c.user_access_token);
    if (!tokenRow?.user_access_token) {
      return json({
        error: "Nenhum token Meta salvo. Reconecte o Instagram para habilitar adição de outras contas.",
        needs_reauth: true,
      }, 404);
    }

    if (tokenRow.user_token_expires_at && new Date(tokenRow.user_token_expires_at) < new Date()) {
      return json({ error: "Token Meta expirou. Reconecte o Instagram.", needs_reauth: true }, 401);
    }

    const userToken = tokenRow.user_access_token;
    const pagesRes = await fetch(
      `${GRAPH}/me/accounts?fields=id,name,instagram_business_account{id,username,profile_picture_url,followers_count}&access_token=${userToken}`
    );
    const pagesData = await pagesRes.json();
    if (!pagesRes.ok) {
      return json({ error: pagesData?.error?.message || "Falha ao consultar Meta", needs_reauth: true }, 401);
    }

    const connectedIds = new Set(
      (conns || []).map((c: any) => c.instagram_user_id).filter(Boolean)
    );

    const available: any[] = [];
    for (const page of pagesData?.data || []) {
      const ig = page.instagram_business_account;
      if (!ig?.id) continue;
      available.push({
        ig_user_id: ig.id,
        ig_username: ig.username || "",
        ig_avatar: ig.profile_picture_url || null,
        ig_followers: ig.followers_count || 0,
        page_id: page.id,
        page_name: page.name,
        already_connected: connectedIds.has(ig.id),
      });
    }

    return json({ ok: true, accounts: available });
  } catch (e) {
    console.error("instagram-list-available-accounts error:", e);
    return json({ error: (e as Error).message || "Erro interno" }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
