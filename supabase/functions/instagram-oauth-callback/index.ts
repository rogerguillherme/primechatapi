import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const metaAppId = Deno.env.get("META_APP_ID")!;
    const metaAppSecret = Deno.env.get("META_APP_SECRET")!;

    // Auth
    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: { user }, error: userError } = await adminClient.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { code, redirect_uri } = await req.json();
    if (!code || !redirect_uri) {
      return new Response(JSON.stringify({ error: "code and redirect_uri are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Exchange code for token
    const tokenUrl = `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${metaAppId}&redirect_uri=${encodeURIComponent(redirect_uri)}&client_secret=${metaAppSecret}&code=${encodeURIComponent(code)}`;
    const tokenRes = await fetch(tokenUrl);
    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      console.error("Token exchange failed:", tokenData);
      return new Response(JSON.stringify({ error: "Falha ao obter token", details: tokenData }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = tokenData.access_token;

    // Get pages the user administers
    const pagesRes = await fetch(
      `https://graph.facebook.com/v19.0/me/accounts?fields=id,name,instagram_business_account{id,username,profile_picture_url,followers_count}&access_token=${accessToken}`
    );
    const pagesData = await pagesRes.json();

    if (!pagesData?.data?.length) {
      return new Response(JSON.stringify({ error: "Nenhuma página do Facebook encontrada. Vincule sua conta Instagram a uma Página." }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Find first page with IG business account
    let igAccount: any = null;
    let pageInfo: any = null;

    for (const page of pagesData.data) {
      if (page.instagram_business_account) {
        igAccount = page.instagram_business_account;
        pageInfo = page;
        break;
      }
    }

    if (!igAccount) {
      return new Response(JSON.stringify({
        error: "Nenhuma conta Instagram Business vinculada encontrada. Verifique se sua conta IG é Business/Creator e está vinculada a uma Página.",
      }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Save connection
    const { data: existing } = await adminClient
      .from("instagram_connections")
      .select("id")
      .eq("user_id", user.id)
      .eq("instagram_user_id", igAccount.id)
      .maybeSingle();

    const storedAccessToken = pageAccessToken || accessToken;

    if (existing) {
      await adminClient
        .from("instagram_connections")
        .update({
          access_token: storedAccessToken,
          instagram_username: igAccount.username,
          page_id: pageInfo.id,
          page_name: pageInfo.name,
          status: "connected",
        })
        .eq("id", existing.id);
    } else {
      await adminClient.from("instagram_connections").insert({
        user_id: user.id,
        instagram_user_id: igAccount.id,
        instagram_username: igAccount.username,
        page_id: pageInfo.id,
        page_name: pageInfo.name,
        access_token: storedAccessToken,
        status: "connected",
      });
    }

    // Get page-level access token (required for webhook subscription)
    const pageTokenRes = await fetch(
      `https://graph.facebook.com/v19.0/${pageInfo.id}?fields=access_token&access_token=${accessToken}`
    );
    const pageTokenData = await pageTokenRes.json();
    const pageAccessToken = pageTokenData.access_token || accessToken;

    // Subscribe page to webhook for comments + messages
    try {
      const subRes = await fetch(
        `https://graph.facebook.com/v19.0/${pageInfo.id}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,comments,feed&access_token=${pageAccessToken}`,
        { method: "POST" }
      );
      const subData = await subRes.json();
      console.log("Webhook subscription:", subData);
    } catch (e) {
      console.error("Webhook subscribe error:", e);
    }

    return new Response(
      JSON.stringify({
        success: true,
        instagram_username: igAccount.username,
        instagram_user_id: igAccount.id,
        page_name: pageInfo.name,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Instagram OAuth callback error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message || "Erro interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
