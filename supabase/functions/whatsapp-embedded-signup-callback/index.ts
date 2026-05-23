import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GRAPH = "https://graph.facebook.com/v21.0";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const appId = Deno.env.get("META_APP_ID")!;
    const appSecret = Deno.env.get("META_APP_SECRET")!;

    const authHeader = req.headers.get("authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }
    const userJwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: { user }, error: userErr } = await admin.auth.getUser(userJwt);
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);

    const { code, state } = await req.json();
    if (!code || !state) return json({ error: "code e state são obrigatórios" }, 400);

    // Validate session
    const { data: session } = await admin
      .from("whatsapp_onboarding_sessions")
      .select("*")
      .eq("state", state)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!session) return json({ error: "Sessão de onboarding inválida ou expirada" }, 400);
    if (session.status === "completed") {
      return json({ error: "Sessão já utilizada", already: true }, 409);
    }

    const redirectUri = (session.metadata as any)?.redirect_uri;
    if (!redirectUri) return json({ error: "redirect_uri ausente na sessão" }, 400);

    // Exchange code → business integration system user token (permanent)
    const tokenUrl = `${GRAPH}/oauth/access_token`
      + `?client_id=${encodeURIComponent(appId)}`
      + `&client_secret=${encodeURIComponent(appSecret)}`
      + `&redirect_uri=${encodeURIComponent(redirectUri)}`
      + `&code=${encodeURIComponent(code)}`;

    const tokenRes = await fetch(tokenUrl);
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      await admin.from("whatsapp_audit_log").insert({
        user_id: user.id, event: "embedded_signup_token_exchange_failed",
        flags: ["token_exchange_failed"], details: { tokenData },
      });
      return json({ error: "Falha ao trocar code por token", details: tokenData }, 422);
    }
    const accessToken = tokenData.access_token as string;

    // Debug token → app_id, scopes, granular waba ids
    const dbgRes = await fetch(
      `${GRAPH}/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(appId + "|" + appSecret)}`
    );
    const dbg = await dbgRes.json();
    const dbgData = dbg?.data || {};
    const tokenAppId = String(dbgData.app_id || "");
    if (tokenAppId && tokenAppId !== appId) {
      return json({ error: `Token de app diferente (${tokenAppId} vs ${appId})` }, 422);
    }

    // Discover WABAs available to this token
    const wabaIds = new Set<string>();
    const businessIds = new Set<string>();
    for (const g of dbgData.granular_scopes || []) {
      if (g.scope === "whatsapp_business_management" || g.scope === "whatsapp_business_messaging") {
        for (const t of g.target_ids || []) wabaIds.add(String(t));
      }
      if (g.scope === "business_management") {
        for (const t of g.target_ids || []) businessIds.add(String(t));
      }
    }

    if (wabaIds.size === 0) {
      // Fallback: list businesses → list owned wabas
      for (const bid of businessIds) {
        const r = await fetch(`${GRAPH}/${bid}/owned_whatsapp_business_accounts?access_token=${accessToken}`);
        const d = await r.json();
        for (const w of d?.data || []) if (w?.id) wabaIds.add(String(w.id));
      }
    }

    const provisioned: any[] = [];

    for (const wabaId of wabaIds) {
      // Owner business
      const wabaInfoRes = await fetch(
        `${GRAPH}/${wabaId}?fields=id,name,owner_business_info,on_behalf_of_business_info&access_token=${accessToken}`
      );
      const wabaInfo = await wabaInfoRes.json();
      const businessId = wabaInfo?.owner_business_info?.id || wabaInfo?.on_behalf_of_business_info?.id || null;

      // Subscribe Prime app to this WABA
      const subRes = await fetch(`${GRAPH}/${wabaId}/subscribed_apps`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const subData = await subRes.json().catch(() => ({}));

      // List phone numbers
      const phonesRes = await fetch(
        `${GRAPH}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,code_verification_status,quality_rating,platform_type,is_on_biz_app,certificate&access_token=${accessToken}`
      );
      const phonesData = await phonesRes.json();

      for (const p of phonesData?.data || []) {
        const phoneNumberId = String(p.id);
        const phoneNumber = String(p.display_phone_number || "");
        const name = p.verified_name || phoneNumber || "WhatsApp";

        // Upsert by phone_number_id (global unique)
        const { data: existing } = await admin
          .from("whatsapp_accounts")
          .select("id, user_id, onboarding_method")
          .eq("phone_number_id", phoneNumberId)
          .maybeSingle();

        const payload: any = {
          user_id: user.id,
          name,
          phone_number: phoneNumber,
          phone_number_id: phoneNumberId,
          business_account_id: wabaId,
          access_token: accessToken,
          app_id: appId,
          business_id: businessId,
          onboarding_method: "embedded_signup",
          token_type: "system_user",
          provisioned_at: new Date().toISOString(),
          last_health_at: new Date().toISOString(),
          last_health_status: "embedded_signup_ok",
          status: "active",
        };

        let accountId: string;
        if (existing) {
          // If a legacy row exists, supersede it but keep same id to preserve linked automations
          await admin.from("whatsapp_accounts").update(payload).eq("id", existing.id);
          accountId = existing.id;
        } else {
          const { data: ins } = await admin.from("whatsapp_accounts").insert(payload).select("id").single();
          accountId = ins!.id;
        }

        await admin.from("whatsapp_audit_log").insert({
          account_id: accountId,
          user_id: user.id,
          event: "embedded_signup_provisioned",
          flags: subData?.success === true ? [] : ["subscription_uncertain"],
          details: {
            waba_id: wabaId,
            phone_number_id: phoneNumberId,
            display_phone_number: phoneNumber,
            subscribed_apps_response: subData,
            phone_info: p,
          },
        });

        provisioned.push({ account_id: accountId, waba_id: wabaId, phone_number_id: phoneNumberId, phone_number: phoneNumber });
      }
    }

    await admin.from("whatsapp_onboarding_sessions").update({
      status: "completed",
      completed_at: new Date().toISOString(),
      metadata: { ...(session.metadata as any), provisioned, wabaIds: [...wabaIds], businessIds: [...businessIds] },
    }).eq("id", session.id);

    return json({ success: true, provisioned, waba_ids: [...wabaIds] });
  } catch (e) {
    console.error("embedded-signup-callback error", e);
    return json({ error: e instanceof Error ? e.message : "internal" }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
