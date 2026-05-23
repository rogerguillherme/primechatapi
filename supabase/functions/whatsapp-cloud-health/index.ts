import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Comprehensive WhatsApp Cloud API health & architecture audit.
 *
 * For each WhatsApp account belonging to the caller, returns:
 *   - Phone provisioning (platform_type, throughput, verification, name status, quality)
 *   - WABA → phone_numbers listing (to detect partial migration / hybrid)
 *   - subscribed_apps (which Meta app actually receives inbound webhooks)
 *   - debug_token (which app owns the access token used by send & subscribe)
 *   - Webhook callback config on the app (configured URL + subscribed fields)
 *   - last inbound webhook seen in webhook_debug table
 *   - hybrid detection verdict
 *   - actionable diagnosis
 *
 * Body: { account_id?: string } - audits all accounts if omitted
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

    const envAppId = Deno.env.get("META_APP_ID") || "";
    const envAppSecret = Deno.env.get("META_APP_SECRET") || "";
    const envVerifyToken = Deno.env.get("WHATSAPP_VERIFY_TOKEN") || "";
    const webhookCallbackUrl = `${supabaseUrl}/functions/v1/whatsapp-cloud-webhook`;

    let q = admin
      .from("whatsapp_accounts")
      .select("id, name, business_account_id, phone_number_id, access_token, user_id")
      .eq("user_id", user.id);
    if (accountId) q = q.eq("id", accountId);

    const { data: accounts, error } = await q;
    if (error) throw new Error(error.message);
    if (!accounts?.length) return json({ error: "Nenhuma conta encontrada" }, 404);

    const results: any[] = [];

    for (const acc of accounts) {
      const findings: string[] = [];
      const verdict = {
        cloud_api_pure: false as boolean | "unknown",
        business_app_active: "unknown" as boolean | "unknown",
        hybrid_suspected: false,
        app_owner_match: "unknown" as boolean | "unknown",
        inbound_likely_working: "unknown" as boolean | "unknown",
      };

      // ---- 1) Resolve best token (OAuth user token preferred)
      const { data: metaConn } = await admin
        .from("meta_connections")
        .select("meta_access_token")
        .eq("user_id", user.id)
        .eq("waba_id", acc.business_account_id || "")
        .eq("status", "connected")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const accessToken = metaConn?.meta_access_token || acc.access_token;
      const tokenSource = metaConn?.meta_access_token ? "oauth_user_token" : "account_token";

      // ---- 2) debug_token → identify app owning the token
      let tokenAppId: string | null = null;
      let tokenScopes: string[] = [];
      let tokenType: string | null = null;
      let tokenValid: boolean | null = null;
      let tokenExpiresAt: number | null = null;
      if (envAppId && envAppSecret && accessToken) {
        try {
          const r = await fetch(
            `https://graph.facebook.com/v21.0/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(`${envAppId}|${envAppSecret}`)}`,
          );
          const d = await r.json();
          tokenAppId = d?.data?.app_id ?? null;
          tokenScopes = d?.data?.scopes ?? [];
          tokenType = d?.data?.type ?? null;
          tokenValid = !!d?.data?.is_valid;
          tokenExpiresAt = d?.data?.expires_at ?? null;
        } catch (_) { /* ignore */ }
      }

      // ---- 3) GET /{PHONE_NUMBER_ID}
      let phoneInfo: any = null;
      if (acc.phone_number_id && accessToken) {
        try {
          const fields = "display_phone_number,verified_name,quality_rating,platform_type,throughput,code_verification_status,name_status,status,messaging_limit_tier,is_official_business_account,certificate";
          const r = await fetch(
            `https://graph.facebook.com/v21.0/${acc.phone_number_id}?fields=${fields}&access_token=${encodeURIComponent(accessToken)}`,
          );
          phoneInfo = await r.json();
        } catch (e: any) {
          phoneInfo = { error: e?.message };
        }
      }

      // ---- 4) GET /{WABA_ID}/phone_numbers
      let wabaPhones: any = null;
      if (acc.business_account_id && accessToken) {
        try {
          const fields = "display_phone_number,verified_name,quality_rating,platform_type,throughput,code_verification_status,name_status,status,id";
          const r = await fetch(
            `https://graph.facebook.com/v21.0/${acc.business_account_id}/phone_numbers?fields=${fields}&access_token=${encodeURIComponent(accessToken)}`,
          );
          wabaPhones = await r.json();
        } catch (e: any) {
          wabaPhones = { error: e?.message };
        }
      }

      // ---- 5) GET /{WABA_ID}/subscribed_apps
      let subscribedApps: any = null;
      let subscribedAppIds: string[] = [];
      if (acc.business_account_id && accessToken) {
        try {
          const r = await fetch(
            `https://graph.facebook.com/v21.0/${acc.business_account_id}/subscribed_apps?access_token=${encodeURIComponent(accessToken)}`,
          );
          subscribedApps = await r.json();
          subscribedAppIds = (subscribedApps?.data || [])
            .map((a: any) => String(a?.whatsapp_business_api_data?.id ?? a?.id ?? ""))
            .filter(Boolean);
        } catch (e: any) {
          subscribedApps = { error: e?.message };
        }
      }

      // ---- 6) GET app webhook config (subscriptions on the App)
      let appSubscriptions: any = null;
      if (envAppId && envAppSecret) {
        try {
          const r = await fetch(
            `https://graph.facebook.com/v21.0/${envAppId}/subscriptions?access_token=${encodeURIComponent(`${envAppId}|${envAppSecret}`)}`,
          );
          appSubscriptions = await r.json();
        } catch (e: any) {
          appSubscriptions = { error: e?.message };
        }
      }
      const whatsappSub = (appSubscriptions?.data || []).find((s: any) => s.object === "whatsapp_business");
      const subscribedFields: string[] = (whatsappSub?.fields || []).map((f: any) => f?.name ?? f).filter(Boolean);
      const configuredCallbackUrl: string | null = whatsappSub?.callback_url ?? null;
      const callbackActive: boolean | null = whatsappSub?.active ?? null;
      const callbackMatches = configuredCallbackUrl ? configuredCallbackUrl === webhookCallbackUrl : null;

      // ---- 7) Last inbound webhook from debug table
      const { data: lastInbound } = await admin
        .from("webhook_debug")
        .select("created_at, parsed, notes")
        .eq("source", "whatsapp-cloud-webhook")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { count: webhookCount24h } = await admin
        .from("webhook_debug")
        .select("*", { count: "exact", head: true })
        .eq("source", "whatsapp-cloud-webhook")
        .gte("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString());

      // ---- 8) Verdict & diagnosis
      const platformType: string | null = phoneInfo?.platform_type ?? null;
      const codeVerif: string | null = phoneInfo?.code_verification_status ?? null;
      const nameStatus: string | null = phoneInfo?.name_status ?? null;
      const throughputLevel: string | null = phoneInfo?.throughput?.level ?? null;

      if (platformType === "CLOUD_API") {
        verdict.cloud_api_pure = true;
      } else if (platformType === "ON_PREMISE" || platformType === "OBA") {
        verdict.cloud_api_pure = false;
        verdict.hybrid_suspected = true;
        findings.push(`platform_type=${platformType} — número NÃO está em Cloud API pura`);
      } else if (platformType == null) {
        verdict.cloud_api_pure = "unknown";
        findings.push("platform_type ausente — número pode não estar totalmente provisionado");
      }

      if (throughputLevel === "NOT_APPLICABLE") {
        verdict.hybrid_suspected = true;
        findings.push("throughput=NOT_APPLICABLE — número não está roteando via Cloud API");
      }

      if (codeVerif && codeVerif !== "VERIFIED" && codeVerif !== "EXPIRED") {
        findings.push(`code_verification_status=${codeVerif} — número não verificado para Cloud API`);
      }

      // App owner check
      const expectedAppId = String(envAppId || tokenAppId || "");
      if (expectedAppId && subscribedAppIds.length) {
        verdict.app_owner_match = subscribedAppIds.includes(expectedAppId);
        if (!verdict.app_owner_match) {
          findings.push(
            `App ${expectedAppId} NÃO está em subscribed_apps da WABA. Apps inscritos: ${subscribedAppIds.join(", ") || "nenhum"}. Inbound vai para OUTRO app.`,
          );
        }
      } else if (expectedAppId && !subscribedAppIds.length) {
        verdict.app_owner_match = false;
        findings.push("Nenhum app inscrito na WABA — inbound não tem destino. Rode subscribe.");
      }

      if (envAppId && tokenAppId && envAppId !== String(tokenAppId)) {
        findings.push(
          `Token pertence ao app ${tokenAppId} mas META_APP_ID=${envAppId}. Mismatch entre app OAuth e app webhook.`,
        );
      }

      if (!subscribedFields.includes("messages")) {
        findings.push("Campo `messages` NÃO está inscrito no webhook do App.");
      }
      if (callbackMatches === false) {
        findings.push(`Callback URL configurada (${configuredCallbackUrl}) NÃO bate com a esperada (${webhookCallbackUrl}).`);
      }
      if (callbackActive === false) {
        findings.push("Webhook do App está INATIVO no painel da Meta.");
      }

      // Hybrid heuristic: outbound works (you can send) but no inbound in 24h + suspicious flags
      if ((webhookCount24h ?? 0) === 0) {
        findings.push("Nenhum webhook inbound recebido nas últimas 24h.");
      }

      verdict.inbound_likely_working =
        verdict.cloud_api_pure === true &&
        verdict.app_owner_match === true &&
        subscribedFields.includes("messages") &&
        (callbackMatches !== false) &&
        callbackActive !== false;

      // Root-cause hypothesis
      let rootCause = "indeterminado";
      if (verdict.hybrid_suspected) {
        rootCause = "Número parcialmente migrado / não está em Cloud API pura (provavelmente ainda registrado no WhatsApp Business App).";
      } else if (verdict.app_owner_match === false) {
        rootCause = "App OAuth ≠ App inscrito na WABA. Inbound chega em outro app.";
      } else if (!subscribedFields.includes("messages")) {
        rootCause = "Campo `messages` não inscrito no webhook do App.";
      } else if (callbackMatches === false || callbackActive === false) {
        rootCause = "Webhook do App mal configurado (URL diferente ou inativo).";
      } else if ((webhookCount24h ?? 0) === 0 && verdict.cloud_api_pure === true && verdict.app_owner_match === true) {
        rootCause = "Provisionamento Cloud OK e app inscrito, mas zero inbound em 24h — verificar se WhatsApp Business App ainda está logado no celular interceptando mensagens, ou se o número precisa ser reverificado/reregistrado.";
      }

      const report = {
        account: {
          id: acc.id,
          name: acc.name,
          waba_id: acc.business_account_id,
          phone_number_id: acc.phone_number_id,
        },
        env: {
          meta_app_id: envAppId || null,
          verify_token_set: !!envVerifyToken,
          webhook_callback_url: webhookCallbackUrl,
        },
        token: {
          source: tokenSource,
          app_id: tokenAppId,
          type: tokenType,
          valid: tokenValid,
          expires_at: tokenExpiresAt,
          scopes: tokenScopes,
        },
        phone: phoneInfo,
        waba_phone_numbers: wabaPhones,
        subscribed_apps: {
          raw: subscribedApps,
          app_ids: subscribedAppIds,
          expected_app_id: expectedAppId,
          app_present: subscribedAppIds.includes(expectedAppId),
        },
        app_webhook: {
          configured_callback_url: configuredCallbackUrl,
          callback_matches_expected: callbackMatches,
          active: callbackActive,
          subscribed_fields: subscribedFields,
          raw: appSubscriptions,
        },
        inbound: {
          last_received_at: lastInbound?.created_at ?? null,
          last_payload_summary: lastInbound?.parsed ?? null,
          received_24h_count: webhookCount24h ?? 0,
        },
        verdict,
        findings,
        root_cause_hypothesis: rootCause,
      };

      console.log(`=== HEALTH ${acc.name} ===`, JSON.stringify(report));
      results.push(report);
    }

    return json({ ok: true, generated_at: new Date().toISOString(), accounts: results });
  } catch (e: any) {
    console.error("cloud-health error:", e);
    return json({ error: e?.message || "Erro interno" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
