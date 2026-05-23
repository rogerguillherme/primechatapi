// Meta OAuth callback (legacy OAuth flow) — multi-WABA provisioning.
//
// Responsibilities:
// 1. Exchange OAuth `code` for a long-lived user/system access token.
// 2. Validate token ownership via debug_token (proof of app ownership).
// 3. Discover WABAs via granular_scopes + owned_whatsapp_business_accounts.
// 4. For each WABA:
//    - subscribe our app to WABA webhooks (POST /{waba_id}/subscribed_apps)
//    - upsert each phone_number into whatsapp_accounts with the per-account token
//    - audit oauth_provisioned / subscribed_apps / app_ownership_check
// 5. NEVER write the global WHATSAPP_ACCESS_TOKEN env back into runtime paths.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GRAPH = "https://graph.facebook.com/v21.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type AuditEvent =
  | "oauth_provisioned"
  | "subscribed_apps"
  | "webhook_check"
  | "token_check"
  | "app_ownership_check";

async function audit(
  admin: any,
  userId: string,
  accountId: string | null,
  event: AuditEvent,
  status: "ok" | "error" | "warning",
  details: Record<string, unknown> = {},
) {
  try {
    await admin.from("whatsapp_account_audit").insert({
      account_id: accountId,
      user_id: userId,
      event,
      status,
      details,
    });
  } catch (e) {
    console.error("audit insert failed", event, e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const metaAppId = Deno.env.get("META_APP_ID")!;
    const metaAppSecret = Deno.env.get("META_APP_SECRET")!;

    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return json(401, { error: "Unauthorized" });
    }
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: { user }, error: userError } = await admin.auth.getUser(jwt);
    if (userError || !user) return json(401, { error: "Não autenticado" });
    const userId = user.id;

    const { code, redirect_uri } = await req.json();
    if (!code || !redirect_uri) {
      return json(400, { error: "code and redirect_uri are required" });
    }

    // ---- 1. Exchange code → access_token ----
    const tokenUrl =
      `${GRAPH}/oauth/access_token?client_id=${metaAppId}` +
      `&redirect_uri=${encodeURIComponent(redirect_uri)}` +
      `&client_secret=${metaAppSecret}&code=${encodeURIComponent(code)}`;
    const tokenRes = await fetch(tokenUrl);
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      console.error("Token exchange failed:", tokenData);
      return json(422, { error: "Falha ao obter token da Meta", details: tokenData });
    }
    const accessToken: string = tokenData.access_token;
    const tokenType: string = tokenData.token_type || "bearer";

    // ---- 2. /me ----
    const meData = await fetch(
      `${GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(accessToken)}`,
    ).then((r) => r.json()).catch(() => ({}));
    const metaUserId: string = meData?.id || "unknown";
    const metaUserName: string = meData?.name || "Conta Meta";

    // ---- 3. debug_token — verify app ownership ----
    const debugData = await fetch(
      `${GRAPH}/debug_token?input_token=${encodeURIComponent(accessToken)}` +
        `&access_token=${encodeURIComponent(`${metaAppId}|${metaAppSecret}`)}`,
    ).then((r) => r.json()).catch(() => ({}));
    const debugInfo = debugData?.data || {};
    const tokenAppId: string = String(debugInfo.app_id || "");
    if (!tokenAppId || tokenAppId !== String(metaAppId)) {
      await audit(admin, userId, null, "app_ownership_check", "error", {
        expected_app_id: metaAppId,
        token_app_id: tokenAppId,
        debug: debugInfo,
      });
      return json(403, {
        error: "Token não pertence a este aplicativo (app_id divergente).",
        expected_app_id: metaAppId,
        token_app_id: tokenAppId,
      });
    }
    await audit(admin, userId, null, "app_ownership_check", "ok", {
      app_id: tokenAppId,
      scopes: debugInfo.scopes,
      expires_at: debugInfo.expires_at,
    });

    // ---- 4. Discover WABAs ----
    const wabaSet = new Set<string>();
    const granular = debugInfo.granular_scopes || [];
    const wbm = granular.find((s: any) => s.scope === "whatsapp_business_management");
    for (const id of wbm?.target_ids || []) wabaSet.add(String(id));

    const bizRes = await fetch(
      `${GRAPH}/me/businesses?access_token=${encodeURIComponent(accessToken)}`,
    ).then((r) => r.json()).catch(() => ({}));
    const businesses = bizRes?.data || [];
    for (const biz of businesses) {
      const owned = await fetch(
        `${GRAPH}/${biz.id}/owned_whatsapp_business_accounts?access_token=${encodeURIComponent(accessToken)}`,
      ).then((r) => r.json()).catch(() => ({}));
      for (const w of owned?.data || []) wabaSet.add(String(w.id));
    }

    // Best-effort: persist a meta_connections record for the login itself.
    try {
      const conn = {
        user_id: userId,
        meta_access_token: accessToken,
        phone_number_id: `fb:${metaUserId}`,
        phone_number: metaUserName,
        waba_id: "",
        status: "connected",
        updated_at: new Date().toISOString(),
      };
      const { data: existing } = await admin
        .from("meta_connections")
        .select("id")
        .eq("user_id", userId)
        .eq("phone_number_id", `fb:${metaUserId}`)
        .maybeSingle();
      if (existing) {
        await admin.from("meta_connections").update(conn).eq("id", existing.id);
      } else {
        await admin.from("meta_connections").insert(conn);
      }
    } catch (e) {
      console.warn("meta_connections persistence skipped:", e);
    }

    // ---- 5. For each WABA: subscribe webhook + upsert each phone_number ----
    const provisioned: Array<{
      account_id: string | null;
      waba_id: string;
      business_id: string | null;
      phone_number_id: string;
      phone_number: string;
      subscribed: boolean;
    }> = [];
    const nowIso = new Date().toISOString();

    for (const wabaId of wabaSet) {
      // WABA details (for business_id)
      const wabaInfo = await fetch(
        `${GRAPH}/${wabaId}?fields=id,name,owner_business_info,on_behalf_of_business_info,primary_funding_id` +
          `&access_token=${encodeURIComponent(accessToken)}`,
      ).then((r) => r.json()).catch(() => ({}));
      const businessId: string | null =
        wabaInfo?.owner_business_info?.id ||
        wabaInfo?.on_behalf_of_business_info?.id ||
        null;

      // Subscribe our app to this WABA's webhooks, with the account's own token.
      let subscribed = false;
      let subStatus: "ok" | "error" = "error";
      let subDetail: Record<string, unknown> = {};
      try {
        const subRes = await fetch(`${GRAPH}/${wabaId}/subscribed_apps`, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const subBody = await subRes.json().catch(() => ({}));
        subscribed = !!(subRes.ok && (subBody?.success === true || subBody?.success === undefined));
        subStatus = subscribed ? "ok" : "error";
        subDetail = { http: subRes.status, body: subBody };
      } catch (e) {
        subDetail = { error: String(e) };
      }

      // Phone numbers under this WABA
      const phonesData = await fetch(
        `${GRAPH}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,messaging_limit_tier` +
          `&access_token=${encodeURIComponent(accessToken)}`,
      ).then((r) => r.json()).catch(() => ({}));
      const phones = phonesData?.data || [];

      if (phones.length === 0) {
        await audit(admin, userId, null, "subscribed_apps", subStatus, {
          waba_id: wabaId,
          ...subDetail,
          note: "no_phone_numbers",
        });
        continue;
      }

      for (const p of phones) {
        const phoneNumberId = String(p.id);
        const name = p.verified_name || p.display_phone_number || `WABA ${wabaId}`;

        // Upsert by phone_number_id (unique constraint exists)
        const upsertPayload = {
          user_id: userId,
          provider: "meta_cloud",
          name,
          phone_number_id: phoneNumberId,
          business_account_id: wabaId,
          business_id: businessId,
          access_token: accessToken,
          token_type: tokenType,
          app_id: metaAppId,
          token_app_id: tokenAppId,
          token_validity: "valid" as const,
          token_checked_at: nowIso,
          meta_user_id: metaUserId,
          onboarding_method: "legacy" as const,
          provisioned_at: nowIso,
          webhook_subscribed: subscribed,
          webhook_subscribed_at: subscribed ? nowIso : null,
          webhook_last_check_at: nowIso,
          webhook_last_status: subscribed ? "ok" : "error",
          updated_at: nowIso,
        };

        const { data: existingAcc } = await admin
          .from("whatsapp_accounts")
          .select("id")
          .eq("phone_number_id", phoneNumberId)
          .maybeSingle();

        let accountId: string | null = null;
        if (existingAcc) {
          accountId = existingAcc.id;
          const { error } = await admin
            .from("whatsapp_accounts")
            .update(upsertPayload)
            .eq("id", existingAcc.id);
          if (error) console.error("update account failed:", error);
        } else {
          const { data: inserted, error } = await admin
            .from("whatsapp_accounts")
            .insert(upsertPayload)
            .select("id")
            .single();
          if (error) console.error("insert account failed:", error);
          accountId = inserted?.id ?? null;
        }

        await audit(admin, userId, accountId, "subscribed_apps", subStatus, {
          waba_id: wabaId,
          phone_number_id: phoneNumberId,
          ...subDetail,
        });
        await audit(admin, userId, accountId, "oauth_provisioned", "ok", {
          waba_id: wabaId,
          business_id: businessId,
          phone_number_id: phoneNumberId,
          phone_number: name,
        });

        provisioned.push({
          account_id: accountId,
          waba_id: wabaId,
          business_id: businessId,
          phone_number_id: phoneNumberId,
          phone_number: name,
          subscribed,
        });
      }
    }

    return json(200, {
      success: true,
      meta_user_id: metaUserId,
      meta_user_name: metaUserName,
      wabas: Array.from(wabaSet),
      provisioned,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro interno no callback da Meta";
    console.error("Meta OAuth callback error:", error);
    return json(500, { error: message });
  }
});
