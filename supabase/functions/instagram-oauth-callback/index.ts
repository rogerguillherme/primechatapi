import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GRAPH = "https://graph.facebook.com/v19.0";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const metaAppId = Deno.env.get("META_APP_ID")!;
    const metaAppSecret = Deno.env.get("META_APP_SECRET")!;

    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: { user }, error: userError } = await adminClient.auth.getUser(token);
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const payload = await req.json();
    const { code, redirect_uri, selected_ig_user_id } = payload;

    // ============================================================
    // FASE 2: Usuário já escolheu a conta — finaliza com user_token salvo temporariamente
    // ============================================================
    if (selected_ig_user_id && payload.user_access_token) {
      return await finalizeConnection(adminClient, user.id, payload.user_access_token, selected_ig_user_id);
    }

    // ============================================================
    // FASE 1: Trocar code por token e listar contas disponíveis
    // ============================================================
    if (!code || !redirect_uri) {
      return json({ error: "code e redirect_uri são obrigatórios" }, 400);
    }

    const tokenUrl = `${GRAPH}/oauth/access_token?client_id=${metaAppId}&redirect_uri=${encodeURIComponent(redirect_uri)}&client_secret=${metaAppSecret}&code=${encodeURIComponent(code)}`;
    const tokenRes = await fetch(tokenUrl);
    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      console.error("Token exchange failed:", tokenData);
      return json({ error: "Falha ao obter token", details: tokenData }, 422);
    }

    const userAccessToken = tokenData.access_token;

    // Buscar todas páginas + contas IG
    const pagesRes = await fetch(
      `${GRAPH}/me/accounts?fields=id,name,instagram_business_account{id,username,profile_picture_url,followers_count}&access_token=${userAccessToken}`
    );
    const pagesData = await pagesRes.json();

    if (!pagesData?.data?.length) {
      return json({ error: "Nenhuma página do Facebook encontrada. Vincule sua conta Instagram a uma Página." }, 422);
    }

    // Listar TODAS as contas IG disponíveis
    const igAccounts: Array<{
      ig_user_id: string;
      ig_username: string;
      ig_avatar?: string;
      ig_followers?: number;
      page_id: string;
      page_name: string;
    }> = [];

    for (const page of pagesData.data) {
      if (page.instagram_business_account) {
        igAccounts.push({
          ig_user_id: page.instagram_business_account.id,
          ig_username: page.instagram_business_account.username || "",
          ig_avatar: page.instagram_business_account.profile_picture_url,
          ig_followers: page.instagram_business_account.followers_count,
          page_id: page.id,
          page_name: page.name,
        });
      }
    }

    if (!igAccounts.length) {
      return json({
        error: "Nenhuma conta Instagram Business vinculada encontrada. Verifique se sua conta IG é Business/Creator e está vinculada a uma Página.",
      }, 422);
    }

    // Se só houver 1 conta, conecta direto (UX igual ao antigo)
    if (igAccounts.length === 1) {
      return await finalizeConnection(adminClient, user.id, userAccessToken, igAccounts[0].ig_user_id);
    }

    // Múltiplas contas — devolve lista para o front escolher
    return json({
      multiple: true,
      user_access_token: userAccessToken,
      accounts: igAccounts,
    });
  } catch (error) {
    console.error("Instagram OAuth callback error:", error);
    return json({ error: (error as Error).message || "Erro interno" }, 500);
  }
});

async function finalizeConnection(adminClient: any, userId: string, userAccessToken: string, selectedIgUserId: string) {
  // Trocar por token long-lived (60 dias) — necessário para reuso futuro ao adicionar outras contas
  let longLivedUserToken = userAccessToken;
  let userTokenExpiresAt: string | null = null;
  try {
    const metaAppId = Deno.env.get("META_APP_ID")!;
    const metaAppSecret = Deno.env.get("META_APP_SECRET")!;
    const ll = await fetch(
      `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${metaAppId}&client_secret=${metaAppSecret}&fb_exchange_token=${userAccessToken}`
    );
    const llData = await ll.json();
    if (ll.ok && llData.access_token) {
      longLivedUserToken = llData.access_token;
      if (llData.expires_in) {
        userTokenExpiresAt = new Date(Date.now() + Number(llData.expires_in) * 1000).toISOString();
      }
    }
  } catch (e) {
    console.warn("Long-lived token exchange failed, using short-lived:", e);
  }

  // Re-buscar páginas com este token e localizar a conta selecionada
  const pagesRes = await fetch(
    `${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username,profile_picture_url,followers_count}&access_token=${longLivedUserToken}`
  );
  const pagesData = await pagesRes.json();

  let igAccount: any = null;
  let pageInfo: any = null;
  for (const page of pagesData?.data || []) {
    if (page.instagram_business_account?.id === selectedIgUserId) {
      igAccount = page.instagram_business_account;
      pageInfo = page;
      break;
    }
  }

  if (!igAccount || !pageInfo) {
    return json({ error: "Conta Instagram selecionada não encontrada na sessão" }, 422);
  }

  // Page access token (necessário para webhooks e DM)
  let pageAccessToken = pageInfo.access_token;
  if (!pageAccessToken) {
    const pageTokenRes = await fetch(
      `${GRAPH}/${pageInfo.id}?fields=access_token&access_token=${longLivedUserToken}`
    );
    const pageTokenData = await pageTokenRes.json();
    pageAccessToken = pageTokenData.access_token || longLivedUserToken;
  }

  // Marcar conexões anteriores deste user para a MESMA conta IG como substituídas
  await adminClient
    .from("instagram_connections")
    .delete()
    .eq("user_id", userId)
    .eq("instagram_user_id", igAccount.id);

  // Inserir nova conexão limpa
  await adminClient.from("instagram_connections").insert({
    user_id: userId,
    instagram_user_id: igAccount.id,
    instagram_username: igAccount.username,
    page_id: pageInfo.id,
    page_name: pageInfo.name,
    access_token: pageAccessToken,
    user_access_token: longLivedUserToken,
    user_token_expires_at: userTokenExpiresAt,
    status: "connected",
  });

  // Subscribe webhooks (page-level + IG-level)
  try {
    await fetch(`${GRAPH}/${pageInfo.id}/subscribed_apps`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subscribed_fields: "messages,messaging_postbacks,feed",
        access_token: pageAccessToken,
      }),
    });
    await fetch(`${GRAPH}/${igAccount.id}/subscribed_apps`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subscribed_fields: "comments,messages,mentions",
        access_token: longLivedUserToken,
      }),
    });
  } catch (e) {
    console.error("Webhook subscription error:", e);
  }

  return json({
    success: true,
    instagram_username: igAccount.username,
    instagram_user_id: igAccount.id,
    page_name: pageInfo.name,
  });
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
