import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Subscribes the configured Meta App to the given WABA so we receive
 * `messages` webhook events (delivered/read/failed/inbound).
 *
 * Body: { account_id?: string }  -> if omitted, subscribes ALL user's accounts
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const { data: { user }, error: userErr } = await adminClient.auth.getUser(token);
    if (userErr || !user) {
      return json({ error: "Não autenticado" }, 401);
    }

    const { account_id } = await req.json().catch(() => ({}));

    let q = adminClient
      .from("whatsapp_accounts")
      .select("id, name, business_account_id, access_token, phone_number_id")
      .eq("user_id", user.id);
    if (account_id) q = q.eq("id", account_id);

    const { data: accounts, error: accErr } = await q;
    if (accErr) throw new Error(accErr.message);
    if (!accounts || accounts.length === 0) {
      return json({ error: "Nenhuma conta encontrada" }, 404);
    }

    const results: any[] = [];

    for (const acc of accounts) {
      const ctx: any = {
        account_id: acc.id,
        name: acc.name,
        waba_id: acc.business_account_id,
        phone_number_id: acc.phone_number_id,
      };

      if (!acc.business_account_id || !acc.access_token) {
        results.push({ ...ctx, ok: false, error: "business_account_id ou access_token ausente" });
        continue;
      }

      try {
        // 1) Resolve the strongest token: OAuth user token if present
        const { data: metaConn } = await adminClient
          .from("meta_connections")
          .select("meta_access_token")
          .eq("user_id", user.id)
          .eq("waba_id", acc.business_account_id)
          .eq("status", "connected")
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const effectiveToken = metaConn?.meta_access_token || acc.access_token;
        const tokenSource = metaConn?.meta_access_token ? "oauth_user_token" : "account_token";

        // 2) Identify which Meta App owns this token (via debug_token)
        const appId = Deno.env.get("META_APP_ID") || "";
        const appSecret = Deno.env.get("META_APP_SECRET") || "";
        let tokenAppId: string | null = null;
        let tokenScopes: string[] = [];
        let tokenType: string | null = null;
        if (appId && appSecret) {
          try {
            const dbgRes = await fetch(
              `https://graph.facebook.com/v21.0/debug_token?input_token=${encodeURIComponent(effectiveToken)}&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`,
            );
            const dbg = await dbgRes.json();
            tokenAppId = dbg?.data?.app_id ?? null;
            tokenScopes = dbg?.data?.scopes ?? [];
            tokenType = dbg?.data?.type ?? null;
          } catch (_) { /* ignore */ }
        }

        // 3) POST subscribed_apps
        const subUrl = `https://graph.facebook.com/v21.0/${acc.business_account_id}/subscribed_apps`;
        const subRes = await fetch(subUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${effectiveToken}` },
        });
        const subText = await subRes.text();
        let subData: any;
        try { subData = JSON.parse(subText); } catch { subData = { raw: subText }; }

        // 4) GET subscribed_apps to confirm
        let listData: any = null;
        try {
          const listRes = await fetch(
            `https://graph.facebook.com/v21.0/${acc.business_account_id}/subscribed_apps?access_token=${encodeURIComponent(effectiveToken)}`,
          );
          listData = await listRes.json();
        } catch (_) { /* ignore */ }

        const subscribedAppIds: string[] = (listData?.data || [])
          .map((a: any) => String(a?.whatsapp_business_api_data?.id ?? a?.id ?? ""))
          .filter(Boolean);

        const expectedAppId = String(appId || tokenAppId || "");
        const success = subData?.success === true;
        const appPresent = expectedAppId ? subscribedAppIds.includes(expectedAppId) : subscribedAppIds.length > 0;

        const logEntry = {
          ...ctx,
          app_id_env: appId || null,
          token_source: tokenSource,
          token_app_id: tokenAppId,
          token_type: tokenType,
          token_scopes: tokenScopes,
          subscribed_apps_response: subData,
          subscribed_apps_status: subRes.status,
          subscribed_apps_list: listData,
          subscribed_app_ids: subscribedAppIds,
          success_flag: success,
          app_present_in_waba: appPresent,
        };
        console.log("=== SUBSCRIBE WABA ===", JSON.stringify(logEntry));

        // Persist diagnostic snapshot
        try {
          await adminClient.from("webhook_debug").insert({
            source: "whatsapp-subscribe-webhook",
            parsed: logEntry,
            notes: success && appPresent ? "ok" : "subscribe failed or app missing",
          });
        } catch (_) { /* ignore */ }

        if (!subRes.ok || subData?.error) {
          results.push({
            ...ctx,
            ok: false,
            error: subData?.error?.message || `HTTP ${subRes.status}`,
            details: logEntry,
          });
          continue;
        }

        results.push({
          ...ctx,
          ok: true,
          subscribed: success,
          app_present_in_waba: appPresent,
          expected_app_id: expectedAppId,
          subscribed_app_ids: subscribedAppIds,
          token_source: tokenSource,
          token_app_id: tokenAppId,
        });
      } catch (e: any) {
        console.error("subscribe error:", e);
        results.push({ ...ctx, ok: false, error: e.message });
      }
    }

    return json({ success: true, results });
  } catch (e: any) {
    console.error("subscribe-webhook error:", e);
    return json({ error: e.message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
