import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Auditoria arquitetural COMPLETA do WhatsApp Cloud API.
 *
 * Para cada conta WhatsApp do usuário, retorna:
 *  - Token forensics (debug_token → app_id, type=USER|SYSTEM|PAGE, scopes, expires_at)
 *  - Conexão Meta armazenada (meta_connections row → indica fluxo OAuth)
 *  - WABA details (owner_business_info, on_behalf_of_business_info, primary_funding_id)
 *  - WABA → phone_numbers (platform_type, certificate, account_mode, code_verification_status, throughput)
 *  - subscribed_apps (qual app recebe inbound)
 *  - Webhook do App (callback_url, fields ativos)
 *  - Último webhook real recebido + contagem 24h
 *  - Heurística de onboarding: Embedded Signup vs OAuth vs System User vs Manual
 *  - Detecção de coexistência (Business App / On-Premise / outro app Meta)
 *  - Diagnóstico final inbound
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
    const envSystemUserToken = Deno.env.get("META_SYSTEM_USER_TOKEN") || "";
    const envVerifyToken = Deno.env.get("WHATSAPP_VERIFY_TOKEN") || "";
    const webhookCallbackUrl = `${supabaseUrl}/functions/v1/whatsapp-cloud-webhook`;

    let q = admin
      .from("whatsapp_accounts")
      .select("id, name, business_account_id, phone_number_id, access_token, user_id, created_at, updated_at")
      .eq("user_id", user.id);
    if (accountId) q = q.eq("id", accountId);

    const { data: accounts, error } = await q;
    if (error) throw new Error(error.message);
    if (!accounts?.length) return json({ error: "Nenhuma conta encontrada" }, 404);

    const results: any[] = [];

    for (const acc of accounts) {
      const findings: string[] = [];

      // ---- 1) meta_connections (rastro do OAuth)
      const { data: metaConn } = await admin
        .from("meta_connections")
        .select("id, meta_access_token, waba_id, phone_number_id, phone_number, status, created_at, updated_at")
        .eq("user_id", user.id)
        .eq("waba_id", acc.business_account_id || "")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const accessToken = metaConn?.meta_access_token || acc.access_token;
      const tokenSource = metaConn?.meta_access_token
        ? "oauth_user_token (meta_connections)"
        : "stored_account_token (whatsapp_accounts)";

      // ---- 2) debug_token → identificação real do token
      let tokenInfo: any = null;
      if (envAppId && envAppSecret && accessToken) {
        try {
          const r = await fetch(
            `https://graph.facebook.com/v21.0/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(`${envAppId}|${envAppSecret}`)}`,
          );
          tokenInfo = (await r.json())?.data ?? null;
        } catch (_) { /* ignore */ }
      }
      const tokenType = tokenInfo?.type ?? null;
      const tokenAppId = tokenInfo?.app_id ?? null;
      const tokenScopes: string[] = tokenInfo?.scopes ?? [];
      const tokenExpires: number | null = tokenInfo?.expires_at ?? null;
      const tokenIsValid: boolean = !!tokenInfo?.is_valid;
      const tokenIsPermanent = tokenExpires === 0;

      // Classificação do token
      let tokenClass = "UNKNOWN";
      if (tokenType === "SYSTEM") tokenClass = "SYSTEM_USER_TOKEN";
      else if (tokenType === "USER" && tokenIsPermanent) tokenClass = "USER_PERMANENT_TOKEN";
      else if (tokenType === "USER") tokenClass = "USER_ACCESS_TOKEN (curto/longo prazo)";
      else if (tokenType === "PAGE") tokenClass = "PAGE_TOKEN";
      else if (tokenType === "APP") tokenClass = "APP_TOKEN";

      // ---- 3) System User token (paralelo) para comparar inbound ownership
      let systemUserTokenInfo: any = null;
      if (envSystemUserToken && envAppId && envAppSecret) {
        try {
          const r = await fetch(
            `https://graph.facebook.com/v21.0/debug_token?input_token=${encodeURIComponent(envSystemUserToken)}&access_token=${encodeURIComponent(`${envAppId}|${envAppSecret}`)}`,
          );
          systemUserTokenInfo = (await r.json())?.data ?? null;
        } catch (_) { /* ignore */ }
      }

      // ---- 4) WABA detalhada (owner_business_info, on_behalf_of, funding)
      let wabaDetails: any = null;
      if (acc.business_account_id && accessToken) {
        try {
          const fields = "id,name,currency,timezone_id,message_template_namespace,owner_business_info,on_behalf_of_business_info,primary_funding_id,business_verification_status,country,ownership_type,account_review_status,health_status";
          const r = await fetch(
            `https://graph.facebook.com/v21.0/${acc.business_account_id}?fields=${fields}&access_token=${encodeURIComponent(accessToken)}`,
          );
          wabaDetails = await r.json();
        } catch (e: any) {
          wabaDetails = { error: e?.message };
        }
      }

      // ---- 5) Phone details (com certificate = sinal de Embedded Signup completo)
      let phoneInfo: any = null;
      if (acc.phone_number_id && accessToken) {
        try {
          const fields = "id,display_phone_number,verified_name,quality_rating,platform_type,throughput,code_verification_status,name_status,status,messaging_limit_tier,is_official_business_account,certificate,account_mode,is_pin_enabled,eligibility_for_api_business_global_search,is_on_biz_app";
          const r = await fetch(
            `https://graph.facebook.com/v21.0/${acc.phone_number_id}?fields=${fields}&access_token=${encodeURIComponent(accessToken)}`,
          );
          phoneInfo = await r.json();
        } catch (e: any) {
          phoneInfo = { error: e?.message };
        }
      }

      // ---- 6) WABA → phone_numbers (todos números)
      let wabaPhones: any = null;
      if (acc.business_account_id && accessToken) {
        try {
          const fields = "id,display_phone_number,verified_name,quality_rating,platform_type,throughput,code_verification_status,name_status,status,certificate,account_mode";
          const r = await fetch(
            `https://graph.facebook.com/v21.0/${acc.business_account_id}/phone_numbers?fields=${fields}&access_token=${encodeURIComponent(accessToken)}`,
          );
          wabaPhones = await r.json();
        } catch (e: any) {
          wabaPhones = { error: e?.message };
        }
      }

      // ---- 7) subscribed_apps
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

      // ---- 8) App webhook subscriptions
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

      // ---- 9) App details (mode: Live vs Development)
      let appInfo: any = null;
      if (envAppId && envAppSecret) {
        try {
          const r = await fetch(
            `https://graph.facebook.com/v21.0/${envAppId}?fields=id,name,namespace,app_type,link,category&access_token=${encodeURIComponent(`${envAppId}|${envAppSecret}`)}`,
          );
          appInfo = await r.json();
        } catch (e: any) {
          appInfo = { error: e?.message };
        }
      }

      // ---- 10) Inbound real
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

      // ====== HEURÍSTICA DE ONBOARDING ======
      // Embedded Signup completo => owner_business_info presente + phone.certificate presente + token USER permanente
      // OAuth only (sem ES) => meta_connections existe, token USER, mas phone.certificate AUSENTE ou WABA on_behalf_of_business_info ausente
      // System User => token type SYSTEM
      // Manual => token armazenado em whatsapp_accounts.access_token sem meta_connections
      const hasCertificate = !!phoneInfo?.certificate;
      const hasOwnerBiz = !!wabaDetails?.owner_business_info?.id;
      const hasOnBehalf = !!wabaDetails?.on_behalf_of_business_info?.id;
      const hasFunding = !!wabaDetails?.primary_funding_id;

      let onboardingMethod = "INDETERMINADO";
      const onboardingEvidence: string[] = [];

      if (tokenType === "SYSTEM") {
        onboardingMethod = "SYSTEM_USER (BSP / manual)";
        onboardingEvidence.push("Token type=SYSTEM");
      } else if (tokenType === "USER" && hasCertificate && hasOnBehalf && hasFunding) {
        onboardingMethod = "EMBEDDED_SIGNUP (oficial Cloud API)";
        onboardingEvidence.push("Token USER + phone.certificate presente + on_behalf_of_business_info + primary_funding_id");
      } else if (tokenType === "USER" && metaConn) {
        onboardingMethod = "OAUTH_ONLY (sem Embedded Signup completo)";
        onboardingEvidence.push("meta_connections existe, mas faltam sinais de ES");
        if (!hasCertificate) onboardingEvidence.push("❌ phone.certificate AUSENTE — número não foi provisionado via ES");
        if (!hasOnBehalf) onboardingEvidence.push("❌ on_behalf_of_business_info AUSENTE — WABA não foi criada via ES no fluxo do app");
        if (!hasFunding) onboardingEvidence.push("❌ primary_funding_id AUSENTE — sem linha de crédito vinculada ao app");
      } else if (!metaConn && acc.access_token) {
        onboardingMethod = "MANUAL_TOKEN (token colado manualmente)";
        onboardingEvidence.push("Sem registro em meta_connections, token armazenado direto em whatsapp_accounts");
      }

      // ====== COEXISTÊNCIA ======
      const coexistenceFlags: string[] = [];
      const platformType: string | null = phoneInfo?.platform_type ?? null;
      const throughputLevel: string | null = phoneInfo?.throughput?.level ?? null;
      const accountMode: string | null = phoneInfo?.account_mode ?? null;
      const isOnBizApp: boolean | null = phoneInfo?.is_on_biz_app ?? null;

      if (platformType && platformType !== "CLOUD_API") {
        coexistenceFlags.push(`platform_type=${platformType} (esperado CLOUD_API) — número em ${platformType === "ON_PREMISE" ? "On-Premise API" : platformType}`);
      }
      if (isOnBizApp === true) {
        coexistenceFlags.push("is_on_biz_app=true → COEXISTÊNCIA com WhatsApp Business App no celular (inbound vai para o celular, não para Cloud)");
      }
      if (throughputLevel === "NOT_APPLICABLE") {
        coexistenceFlags.push("throughput=NOT_APPLICABLE → número não está roteando via Cloud API");
      }
      if (accountMode && accountMode !== "LIVE") {
        coexistenceFlags.push(`account_mode=${accountMode} (esperado LIVE) — provisionamento incompleto`);
      }

      // ====== APP OWNERSHIP ======
      const expectedAppId = String(envAppId || tokenAppId || "");
      const appPresent = subscribedAppIds.includes(expectedAppId);
      const appOwnerMatch = expectedAppId && subscribedAppIds.length ? appPresent : "unknown" as boolean | "unknown";

      if (envAppId && tokenAppId && envAppId !== String(tokenAppId)) {
        findings.push(`⚠️ Token pertence ao app ${tokenAppId} mas META_APP_ID=${envAppId}. Mismatch entre app OAuth e app webhook.`);
      }
      if (expectedAppId && subscribedAppIds.length && !appPresent) {
        findings.push(`❌ App ${expectedAppId} NÃO inscrito na WABA. Apps presentes: ${subscribedAppIds.join(", ") || "nenhum"}. Inbound vai para outro app.`);
      }
      if (!subscribedAppIds.length) {
        findings.push("❌ Nenhum app inscrito na WABA via subscribed_apps.");
      }
      if (!subscribedFields.includes("messages")) {
        findings.push("❌ Field `messages` NÃO inscrito no webhook do App.");
      }
      if (callbackMatches === false) {
        findings.push(`❌ Callback URL configurada (${configuredCallbackUrl}) ≠ esperada (${webhookCallbackUrl}).`);
      }
      if (callbackActive === false) {
        findings.push("❌ Webhook do App INATIVO no painel.");
      }
      if ((webhookCount24h ?? 0) === 0) {
        findings.push("⚠️ Zero webhooks inbound em 24h.");
      }
      if (!tokenIsValid) {
        findings.push("❌ Access token inválido (debug_token.is_valid=false).");
      }

      // ====== DIAGNÓSTICO FINAL ======
      let rootCause = "INDETERMINADO";
      const why: string[] = [];

      if (coexistenceFlags.length) {
        rootCause = "COEXISTÊNCIA com WhatsApp Business App ou número não em Cloud API pura";
        why.push(...coexistenceFlags);
        why.push("→ Outbound funciona (API aceita), inbound vai para o celular/On-Premise");
      } else if (onboardingMethod.startsWith("OAUTH_ONLY")) {
        rootCause = "ONBOARDING INCOMPLETO — número conectado via OAuth comum, NÃO via Embedded Signup oficial";
        why.push("Sem phone.certificate / on_behalf_of_business_info / primary_funding_id, a Meta não trata o número como provisionado pelo app Prime");
        why.push("Outbound funciona porque o token tem whatsapp_business_messaging, mas inbound só é roteado quando o número é onboardado via Embedded Signup do app proprietário");
        why.push("→ Refazer onboarding via Embedded Signup (fbq Login + config_id do app Prime) é obrigatório");
      } else if (appOwnerMatch === false) {
        rootCause = "App inscrito ≠ App esperado (Prime). Inbound chega em outro app.";
      } else if (!subscribedFields.includes("messages")) {
        rootCause = "Field `messages` ausente no webhook do App.";
      } else if (callbackMatches === false || callbackActive === false) {
        rootCause = "Webhook do App mal configurado.";
      } else if ((webhookCount24h ?? 0) === 0) {
        rootCause = "Tudo OK no papel, mas inbound zero — verificar Business App no celular e Advanced Access em App Review.";
      }

      const report = {
        account: {
          id: acc.id,
          name: acc.name,
          waba_id: acc.business_account_id,
          phone_number_id: acc.phone_number_id,
          created_at: acc.created_at,
        },
        env: {
          meta_app_id: envAppId || null,
          system_user_token_set: !!envSystemUserToken,
          verify_token_set: !!envVerifyToken,
          webhook_callback_url: webhookCallbackUrl,
        },
        app: appInfo,
        meta_connection: metaConn
          ? {
              exists: true,
              created_at: metaConn.created_at,
              updated_at: metaConn.updated_at,
              waba_id: metaConn.waba_id,
              phone_number_id: metaConn.phone_number_id,
              status: metaConn.status,
            }
          : { exists: false },
        token_used: {
          source: tokenSource,
          classification: tokenClass,
          app_id: tokenAppId,
          type: tokenType,
          is_valid: tokenIsValid,
          is_permanent: tokenIsPermanent,
          expires_at: tokenExpires,
          scopes: tokenScopes,
          has_whatsapp_business_messaging: tokenScopes.includes("whatsapp_business_messaging"),
          has_whatsapp_business_management: tokenScopes.includes("whatsapp_business_management"),
        },
        system_user_token: systemUserTokenInfo
          ? {
              app_id: systemUserTokenInfo.app_id,
              type: systemUserTokenInfo.type,
              is_valid: systemUserTokenInfo.is_valid,
              scopes: systemUserTokenInfo.scopes,
            }
          : null,
        waba: wabaDetails,
        waba_ownership_signals: {
          owner_business_info: wabaDetails?.owner_business_info ?? null,
          on_behalf_of_business_info: wabaDetails?.on_behalf_of_business_info ?? null,
          primary_funding_id: wabaDetails?.primary_funding_id ?? null,
          ownership_type: wabaDetails?.ownership_type ?? null,
          business_verification_status: wabaDetails?.business_verification_status ?? null,
          health_status: wabaDetails?.health_status ?? null,
          has_owner: hasOwnerBiz,
          has_on_behalf: hasOnBehalf,
          has_funding: hasFunding,
        },
        phone: phoneInfo,
        phone_provisioning_signals: {
          platform_type: platformType,
          throughput_level: throughputLevel,
          account_mode: accountMode,
          code_verification_status: phoneInfo?.code_verification_status ?? null,
          name_status: phoneInfo?.name_status ?? null,
          has_certificate: hasCertificate,
          is_pin_enabled: phoneInfo?.is_pin_enabled ?? null,
          is_on_biz_app: isOnBizApp,
          quality_rating: phoneInfo?.quality_rating ?? null,
          messaging_limit_tier: phoneInfo?.messaging_limit_tier ?? null,
        },
        waba_phone_numbers: wabaPhones,
        subscribed_apps: {
          raw: subscribedApps,
          app_ids: subscribedAppIds,
          expected_app_id: expectedAppId,
          app_present: appPresent,
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
        onboarding_diagnosis: {
          method: onboardingMethod,
          evidence: onboardingEvidence,
        },
        coexistence_flags: coexistenceFlags,
        findings,
        root_cause: rootCause,
        why,
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
