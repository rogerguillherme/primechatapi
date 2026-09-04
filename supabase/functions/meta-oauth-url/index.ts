import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const encoder = new TextEncoder();

function toBase64Url(value: Uint8Array | string): string {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function createOAuthState(userId: string, app: "prime" | "crm", secret: string): Promise<string> {
  const payload = toBase64Url(JSON.stringify({ user_id: userId, app, issued_at: Date.now() }));
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const primeAppId = Deno.env.get("META_APP_ID")!;
    const crmAppId = Deno.env.get("CRM_APP_ID");
    const primeAppSecret = Deno.env.get("META_APP_SECRET");
    const crmAppSecret = Deno.env.get("CRM_APP_SECRET");

    // Authenticate user
    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace(/^Bearer\s+/i, "").trim();

    // Parse body BEFORE auth to avoid double-consuming the stream
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: { user }, error: userError } = await adminClient.auth.getUser(token);

    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const redirect_uri = body.redirect_uri;
    if (!redirect_uri) {
      return new Response(JSON.stringify({ error: "redirect_uri is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Algumas WABAs (ex.: as do Estevão) só aceitam administração pelo app CRM.
    // `app: "crm"` autoriza por aquele app; o padrão continua sendo o Prime.
    const requestedApp = String(body.app || "prime").toLowerCase();
    if (requestedApp !== "prime" && requestedApp !== "crm") {
      return new Response(JSON.stringify({ error: "App Meta inválido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const useCrm = requestedApp === "crm";
    if (useCrm && (!crmAppId || !crmAppSecret)) {
      return new Response(JSON.stringify({ error: "Credenciais do app CRM não configuradas" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!useCrm && !primeAppSecret) {
      return new Response(JSON.stringify({ error: "Credenciais do app Prime não configuradas" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const appId = useCrm ? crmAppId! : primeAppId;
    const appSecret = useCrm ? crmAppSecret! : primeAppSecret!;
    const state = await createOAuthState(user.id, useCrm ? "crm" : "prime", appSecret);

    const oauthUrl = new URL("https://www.facebook.com/v21.0/dialog/oauth");
    oauthUrl.searchParams.set("client_id", appId);
    oauthUrl.searchParams.set("redirect_uri", redirect_uri);
    // `business_management` é necessário para administrar a inscrição da WABA
    // em /subscribed_apps. Sem ele, o token enxerga os números e consegue
    // enviar mensagens, mas a Meta responde (#200) Permissions error ao tentar
    // ativar o webhook — exatamente o cenário em que só o envio funciona.
    oauthUrl.searchParams.set(
      "scope",
      "business_management,whatsapp_business_management,whatsapp_business_messaging",
    );
    oauthUrl.searchParams.set("response_type", "code");
    oauthUrl.searchParams.set("state", state);

    return new Response(
      JSON.stringify({ oauth_url: oauthUrl.toString() }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error generating OAuth URL:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});