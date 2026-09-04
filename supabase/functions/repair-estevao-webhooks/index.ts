import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ACCOUNT_IDS = [
  "83acb612-be39-4905-a3c3-fc55dee8f38e",
  "6c52d473-ad3d-435b-86a3-60eb1daf5635",
];

Deno.serve(async () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const metaAppId = Deno.env.get("META_APP_ID");
  const metaAppSecret = Deno.env.get("META_APP_SECRET");
  if (!supabaseUrl || !serviceRoleKey) {
    return Response.json({ error: "Configuração interna indisponível" }, { status: 500 });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: accounts, error } = await admin
    .from("whatsapp_accounts")
    .select("id, name, business_account_id, access_token")
    .in("id", ACCOUNT_IDS);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const { data: workingAccount } = await admin
    .from("whatsapp_accounts")
    .select("access_token")
    .eq("id", "e388e9c4-a058-4a5b-9490-8835d54a3871")
    .maybeSingle();

  const results = [];
  for (const account of accounts || []) {
    if (!account.business_account_id || !account.access_token) {
      results.push({ account_id: account.id, name: account.name, ok: false, error: "Credenciais ausentes" });
      continue;
    }

    let tokenInfo: Record<string, unknown> | null = null;
    if (metaAppId && metaAppSecret) {
      const debugUrl = new URL("https://graph.facebook.com/v21.0/debug_token");
      debugUrl.searchParams.set("input_token", account.access_token);
      debugUrl.searchParams.set("access_token", `${metaAppId}|${metaAppSecret}`);
      const debugResponse = await fetch(debugUrl);
      const debugBody = await debugResponse.json().catch(() => ({}));
      const data = debugBody?.data;
      tokenInfo = data ? {
        app_id: data.app_id,
        application: data.application,
        is_valid: data.is_valid,
        scopes: data.scopes,
        granular_scopes: data.granular_scopes,
        expires_at: data.expires_at,
        data_access_expires_at: data.data_access_expires_at,
      } : { error: debugBody?.error?.message || `HTTP ${debugResponse.status}` };
    }

    const params = new URLSearchParams({ subscribed_fields: "messages" });
    let response = await fetch(
      `https://graph.facebook.com/v21.0/${account.business_account_id}/subscribed_apps`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${account.access_token}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      },
    );
    let body = await response.json().catch(() => ({}));
    let usedWorkingAccountToken = false;

    // A conta 3399 já entrega eventos neste mesmo endpoint. Se o token recém
    // salvo não puder administrar subscribed_apps apesar de listar a WABA no
    // escopo granular, tenta o token funcional do mesmo tenant/app de webhook.
    if ((!response.ok || body?.error) && workingAccount?.access_token) {
      response = await fetch(
        `https://graph.facebook.com/v21.0/${account.business_account_id}/subscribed_apps`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${workingAccount.access_token}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: params.toString(),
        },
      );
      body = await response.json().catch(() => ({}));
      usedWorkingAccountToken = true;
    }

    const ok = response.ok && !body?.error;

    await admin.from("whatsapp_accounts").update({
      webhook_subscribed: ok,
      webhook_subscribed_at: ok ? new Date().toISOString() : undefined,
      webhook_last_check_at: new Date().toISOString(),
      webhook_last_status: ok
        ? "success (app-level messages subscription)"
        : `error: ${body?.error?.message || `HTTP ${response.status}`}`,
    }).eq("id", account.id);

    results.push({
      account_id: account.id,
      name: account.name,
      ok,
      status: response.status,
      success: body?.success ?? false,
      error: body?.error?.message,
      error_code: body?.error?.code,
      token_info: tokenInfo,
      used_working_account_token: usedWorkingAccountToken,
    });
  }

  return Response.json({ results });
});