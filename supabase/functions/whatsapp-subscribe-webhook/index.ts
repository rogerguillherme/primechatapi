import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function configureAppWebhookSubscription(supabaseUrl: string, verifyToken: string) {
  const metaAppId = Deno.env.get("META_APP_ID");
  const metaAppSecret = Deno.env.get("META_APP_SECRET");

  if (!metaAppId || !metaAppSecret) {
    return { ok: false, skipped: true, reason: "META_APP_ID/META_APP_SECRET ausente" };
  }

  const params = new URLSearchParams();
  params.set("object", "whatsapp_business_account");
  params.set("callback_url", `${supabaseUrl}/functions/v1/whatsapp-cloud-webhook`);
  params.set("fields", "messages");
  params.set("verify_token", verifyToken);
  params.set("include_values", "true");
  params.set("access_token", `${metaAppId}|${metaAppSecret}`);

  const appSubRes = await fetch(`https://graph.facebook.com/v21.0/${metaAppId}/subscriptions`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const appSubText = await appSubRes.text();
  let appSubData: any;
  try { appSubData = JSON.parse(appSubText); } catch { appSubData = { raw: appSubText }; }

  return {
    ok: appSubRes.ok && !appSubData?.error,
    status: appSubRes.status,
    success: appSubData?.success ?? false,
    error: appSubData?.error?.message,
    details: appSubData?.error ? appSubData : undefined,
  };
}

async function subscribeWabaToApp(
  businessAccountId: string,
  accessToken: string,
  supabaseUrl: string,
  verifyToken: string,
) {
  const subUrl = `https://graph.facebook.com/v21.0/${businessAccountId}/subscribed_apps`;

  const withFields = new URLSearchParams();
  withFields.set("override_callback_uri", `${supabaseUrl}/functions/v1/whatsapp-cloud-webhook`);
  withFields.set("verify_token", verifyToken);
  withFields.set("subscribed_fields", "messages");

  let subRes = await fetch(subUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: withFields.toString(),
  });

  let subText = await subRes.text();
  let subData: any;
  try { subData = JSON.parse(subText); } catch { subData = { raw: subText }; }

  if (subRes.ok && !subData?.error) {
    return { ok: true, subscribed: subData?.success ?? true, used_fields_param: true, details: subData };
  }

  // Some Graph API versions ignore/deny subscribed_fields on WABA subscriptions.
  // Retry with the canonical WABA call so the override callback still gets forced.
  const fallback = new URLSearchParams();
  fallback.set("override_callback_uri", `${supabaseUrl}/functions/v1/whatsapp-cloud-webhook`);
  fallback.set("verify_token", verifyToken);

  subRes = await fetch(subUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: fallback.toString(),
  });

  subText = await subRes.text();
  try { subData = JSON.parse(subText); } catch { subData = { raw: subText }; }

  if (subRes.ok && !subData?.error) {
    return { ok: true, subscribed: subData?.success ?? true, used_fields_param: false, details: subData };
  }

  // Tokens do Embedded Signup (escopo whatsapp_business_management, sem ser
  // dono/dev do app) recebem "(#200) Permissions error" ao tentar gravar
  // override_callback_uri. Nesse caso a WABA normalmente JÁ está inscrita no
  // nosso app e os eventos chegam pelo callback configurado no nível do app —
  // então confirmamos via GET antes de reportar falha.
  const appId = Deno.env.get("META_APP_ID");
  const checkRes = await fetch(subUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  const checkText = await checkRes.text();
  let checkData: any;
  try { checkData = JSON.parse(checkText); } catch { checkData = { raw: checkText }; }

  const alreadySubscribed = Array.isArray(checkData?.data)
    && checkData.data.some((d: any) =>
      !appId || String(d?.whatsapp_business_api_data?.id || "") === String(appId));

  if (alreadySubscribed) {
    return {
      ok: true,
      subscribed: true,
      used_fields_param: false,
      via_app_level_callback: true,
      details: checkData,
    };
  }

  return {
    ok: false,
    subscribed: false,
    used_fields_param: false,
    error: subData?.error?.message || (!subRes.ok ? `HTTP ${subRes.status}` : undefined),
    details: subData,
  };
}

/**
 * Subscribes the configured Meta App to the given WABA so we receive
 * `messages` webhook events (delivered/read/failed/inbound).
 *
 * Without this, status updates never arrive and the UI stays stuck at "sent".
 *
 * Body: { account_id?: string }  -> if omitted, subscribes ALL user's accounts
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Configuração interna do backend indisponível");
    }
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const { data: { user }, error: userErr } = await adminClient.auth.getUser(token);
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { account_id } = await req.json().catch(() => ({}));
    const { data: tokenSetting } = await adminClient
      .from("app_settings")
      .select("value")
      .eq("key", "whatsapp_verify_token")
      .maybeSingle();
    const verifyToken = tokenSetting?.value?.trim()
      || Deno.env.get("WHATSAPP_VERIFY_TOKEN")?.trim()
      || "prime_chat_verify_2026";
    const appSubscription = await configureAppWebhookSubscription(supabaseUrl, verifyToken).catch((e: any) => ({
      ok: false,
      error: e?.message || String(e),
    }));

    const { data: isAdmin } = await adminClient.rpc("has_role", {
      _user_id: user.id,
      _role: "admin",
    });

    let q = adminClient
      .from("whatsapp_accounts")
      .select("id, name, business_account_id, access_token, phone_number_id")
    if (!isAdmin) q = q.eq("user_id", user.id);
    if (account_id) q = q.eq("id", account_id);

    const { data: accounts, error: accErr } = await q;
    if (accErr) throw new Error(accErr.message);
    if (!accounts || accounts.length === 0) {
      return new Response(JSON.stringify({ error: "Nenhuma conta encontrada" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: any[] = [];

    for (const acc of accounts) {
      if (!acc.business_account_id || !acc.access_token) {
        results.push({
          account_id: acc.id,
          name: acc.name,
          ok: false,
          error: "business_account_id ou access_token ausente",
        });
        continue;
      }

      try {
        // 1) Subscribe app to WABA  → receive webhook events.
        // Always force the callback override; otherwise Meta may keep or restore
        // the app-level default URL and button replies never reach this webhook.
        const wabaSubscription = await subscribeWabaToApp(
          acc.business_account_id,
          acc.access_token,
          supabaseUrl,
          verifyToken,
        );

        if (!wabaSubscription.ok) {
          results.push({
            account_id: acc.id,
            name: acc.name,
            ok: false,
            app_subscription: appSubscription,
            error: wabaSubscription.error || "Falha ao assinar WABA",
            details: wabaSubscription.details,
          });
          continue;
        }

        // 2) Update DB flag
        const { error: updateErr } = await adminClient
          .from("whatsapp_accounts")
          .update({ 
            webhook_subscribed: true,
            webhook_subscribed_at: new Date().toISOString(),
            webhook_last_check_at: new Date().toISOString(),
            webhook_last_status: appSubscription.ok
              ? "success (app messages + override_callback_uri)"
              : `success override; app messages warning: ${appSubscription.error || appSubscription.reason || "unknown"}`
          })
          .eq("id", acc.id);

        results.push({
          account_id: acc.id,
          name: acc.name,
          ok: !updateErr,
          subscribed: wabaSubscription.subscribed,
          app_subscription: appSubscription,
          used_fields_param: wabaSubscription.used_fields_param,
          db_updated: !updateErr,
          update_error: updateErr?.message,
        });
      } catch (e: any) {
        // ... (existing error handling)
        results.push({
          account_id: acc.id,
          name: acc.name,
          ok: false,
          error: e.message,
        });
        
        await adminClient
          .from("whatsapp_accounts")
          .update({ 
            webhook_last_check_at: new Date().toISOString(),
            webhook_last_status: "error"
          })
          .eq("id", acc.id);
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("subscribe-webhook error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
