import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const appId = Deno.env.get("META_APP_ID")!;
    const configId = Deno.env.get("META_EMBEDDED_SIGNUP_CONFIG_ID")!;

    const authHeader = req.headers.get("authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: { user }, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const { redirect_origin, mode } = body as { redirect_origin?: string; mode?: string };
    const origin = typeof redirect_origin === "string" && redirect_origin.startsWith("http")
      ? redirect_origin
      : "https://primechatapi.lovable.app";

    const state = crypto.randomUUID();
    const redirectUri = `${origin}/auth/meta/whatsapp/callback`;
    const isSdk = mode === "sdk";

    await admin.from("whatsapp_onboarding_sessions").insert({
      user_id: user.id,
      state,
      status: "pending",
      metadata: { redirect_uri: isSdk ? "" : redirectUri, origin, mode: isSdk ? "sdk" : "redirect" },
    });

    if (isSdk) {
      // JS SDK flow — client calls FB.login directly; no redirect URL needed
      return json({ state, mode: "sdk", app_id: appId, config_id: configId });
    }

    const extras = encodeURIComponent(JSON.stringify({
      version: "v4",
      sessionInfoVersion: "3",
      featureType: "whatsapp_business_app_onboarding",
    }));

    const url =
      `https://business.facebook.com/messaging/whatsapp/onboard/` +
      `?app_id=${encodeURIComponent(appId)}` +
      `&config_id=${encodeURIComponent(configId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodeURIComponent(state)}` +
      `&extras=${extras}`;

    return json({ url, state });
  } catch (e) {
    console.error("embedded-signup-start error", e);
    return json({ error: e instanceof Error ? e.message : "internal" }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
