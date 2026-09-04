import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const encoder = new TextEncoder();

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function verifyOAuthState(
  state: unknown,
  userId: string,
  primeSecret: string,
  crmSecret?: string,
): Promise<"prime" | "crm" | null> {
  if (typeof state !== "string") return null;
  const [payload, encodedSignature] = state.split(".");
  if (!payload || !encodedSignature) return null;

  let parsed: { user_id?: string; app?: string; issued_at?: number };
  try {
    parsed = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
  } catch {
    return null;
  }
  if (parsed.user_id !== userId || (parsed.app !== "prime" && parsed.app !== "crm")) return null;
  if (typeof parsed.issued_at !== "number" || Date.now() - parsed.issued_at > 15 * 60 * 1000) return null;

  const secret = parsed.app === "crm" ? crmSecret : primeSecret;
  if (!secret) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    fromBase64Url(encodedSignature),
    encoder.encode(payload),
  );
  return valid ? parsed.app : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const primeAppId = Deno.env.get("META_APP_ID")!;
    const primeAppSecret = Deno.env.get("META_APP_SECRET")!;
    const crmAppId = Deno.env.get("CRM_APP_ID");
    const crmAppSecret = Deno.env.get("CRM_APP_SECRET");

    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: { user }, error: userError } = await adminClient.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = user.id;

    const { code, redirect_uri, app, state } = await req.json();
    if (!code || !redirect_uri) {
      return new Response(JSON.stringify({ error: "code and redirect_uri are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // O código só pode ser trocado pelo MESMO app que abriu a autorização.
    const stateApp = await verifyOAuthState(state, userId, primeAppSecret, crmAppSecret ?? undefined);
    // `state` sobrevive ao retorno em outro domínio. O parâmetro `app` fica
    // apenas como compatibilidade para autorizações Prime iniciadas antes desta versão.
    if (state && !stateApp) {
      return new Response(JSON.stringify({ error: "Estado OAuth inválido ou expirado. Inicie a conexão novamente." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const selectedApp = stateApp ?? (String(app || "prime").toLowerCase() === "crm" ? "crm" : "prime");
    const useCrm = selectedApp === "crm";
    if (useCrm && (!crmAppId || !crmAppSecret)) {
      return new Response(JSON.stringify({ error: "Credenciais do app CRM não configuradas" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const metaAppId = useCrm ? crmAppId! : primeAppId;
    const metaAppSecret = useCrm ? crmAppSecret! : primeAppSecret;

    // Exchange code for access_token
    const tokenUrl = `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${metaAppId}&redirect_uri=${encodeURIComponent(redirect_uri)}&client_secret=${metaAppSecret}&code=${encodeURIComponent(code)}`;
    const tokenRes = await fetch(tokenUrl);
    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      console.error("Token exchange failed:", tokenData);
      return new Response(JSON.stringify({ error: "Falha ao obter token da Meta", details: tokenData }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = tokenData.access_token;

    // Save connection with just the token — user will pick WABA/number via UI
    const { data: existing } = await adminClient
      .from("meta_connections")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "connected")
      .maybeSingle();

    if (existing) {
      const { error: updateError } = await adminClient
        .from("meta_connections")
        .update({
          meta_access_token: accessToken,
          status: "connected",
          app_id: metaAppId,
        })
        .eq("id", existing.id);
      if (updateError) throw new Error(`Falha ao salvar conexão Meta: ${updateError.message}`);
    } else {
      const { error: insertError } = await adminClient.from("meta_connections").insert({
        user_id: userId,
        meta_access_token: accessToken,
        status: "connected",
        app_id: metaAppId,
      });
      if (insertError) throw new Error(`Falha ao salvar conexão Meta: ${insertError.message}`);
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro interno no callback da Meta";
    console.error("Meta OAuth callback error:", error);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
