import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Diagnostic: GET /{WABA_ID}/subscribed_apps
 * Returns which Meta apps are currently subscribed to the WABA (i.e. who
 * actually receives inbound webhooks).
 *
 * Body: { account_id?: string, waba_id?: string }
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const { data: { user }, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !user) return json({ error: "Não autenticado" }, 401);

    const body = await req.json().catch(() => ({}));
    const accountId: string | undefined = body?.account_id;
    const wabaIdFilter: string | undefined = body?.waba_id;

    let q = admin
      .from("whatsapp_accounts")
      .select("id, name, business_account_id, phone_number_id, access_token")
      .eq("user_id", user.id);
    if (accountId) q = q.eq("id", accountId);
    if (wabaIdFilter) q = q.eq("business_account_id", wabaIdFilter);

    const { data: accounts, error } = await q;
    if (error) throw new Error(error.message);
    if (!accounts?.length) return json({ error: "Nenhuma conta encontrada" }, 404);

    const appId = Deno.env.get("META_APP_ID") || "";
    const appSecret = Deno.env.get("META_APP_SECRET") || "";

    const results: any[] = [];

    for (const acc of accounts) {
      const ctx = {
        account_id: acc.id,
        name: acc.name,
        waba_id: acc.business_account_id,
        phone_number_id: acc.phone_number_id,
      };
      if (!acc.business_account_id) {
        results.push({ ...ctx, ok: false, error: "waba_id ausente" });
        continue;
      }

      // Resolve token
      const { data: metaConn } = await admin
        .from("meta_connections")
        .select("meta_access_token")
        .eq("user_id", user.id)
        .eq("waba_id", acc.business_account_id)
        .eq("status", "connected")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const accessToken = metaConn?.meta_access_token || acc.access_token;
      const tokenSource = metaConn?.meta_access_token ? "oauth_user_token" : "account_token";

      if (!accessToken) {
        results.push({ ...ctx, ok: false, error: "access_token ausente" });
        continue;
      }

      // debug_token → identify owning app
      let tokenAppId: string | null = null;
      if (appId && appSecret) {
        try {
          const dbgRes = await fetch(
            `https://graph.facebook.com/v21.0/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`,
          );
          const dbg = await dbgRes.json();
          tokenAppId = dbg?.data?.app_id ?? null;
        } catch (_) { /* ignore */ }
      }

      // GET subscribed_apps
      const url = `https://graph.facebook.com/v21.0/${acc.business_account_id}/subscribed_apps?access_token=${encodeURIComponent(accessToken)}`;
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));

      const apps = (data?.data || []).map((a: any) => ({
        id: String(a?.whatsapp_business_api_data?.id ?? a?.id ?? ""),
        name: a?.whatsapp_business_api_data?.name ?? a?.name ?? null,
        link: a?.whatsapp_business_api_data?.link ?? null,
      }));

      const expectedAppId = String(appId || tokenAppId || "");
      const appPresent = expectedAppId ? apps.some((a: any) => a.id === expectedAppId) : apps.length > 0;

      const entry = {
        ...ctx,
        ok: res.ok && !data?.error,
        http_status: res.status,
        token_source: tokenSource,
        expected_app_id: expectedAppId,
        token_app_id: tokenAppId,
        subscribed_apps: apps,
        app_present_in_waba: appPresent,
        raw: data,
      };
      console.log("=== CHECK SUBSCRIPTION ===", JSON.stringify(entry));
      results.push(entry);
    }

    return json({ ok: true, results });
  } catch (e: any) {
    console.error("check-subscription error:", e);
    return json({ error: e.message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
