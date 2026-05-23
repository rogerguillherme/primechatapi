// Auditoria definitiva multi-WABA.
// Para cada whatsapp_accounts (provider=meta_cloud):
//   1. GET /{waba_id}/subscribed_apps com token da conta -> lista de apps inscritos
//   2. GET /{waba_id}?fields=id,name,owner_business_info com token da conta
//   3. GET /debug_token?input_token=... -> app_id real do token (token context)
//   4. GET /{phone_number_id}?fields=id,display_phone_number,verified_name
//   5. Cruza com META_APP_ID esperado e devolve relatório completo
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const EXPECTED_APP_ID = Deno.env.get("META_APP_ID") || "2203903780421152";
const APP_SECRET = Deno.env.get("META_APP_SECRET") || "";
const GRAPH = "https://graph.facebook.com/v21.0";

function tokenFp(t: string | null | undefined) {
  if (!t) return "none";
  return `${t.slice(0, 6)}…${t.slice(-4)} len=${t.length}`;
}

async function graphGet(path: string, token: string) {
  const url = `${GRAPH}${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  const text = await res.text();
  let json: any; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, ok: res.ok, body: json };
}

async function debugToken(token: string) {
  // debug_token precisa de app-token (APP_ID|APP_SECRET) idealmente, mas user token + app secret também funciona
  if (!APP_SECRET) {
    // Sem app_secret -> usa o próprio token (Meta aceita para self-inspection)
    const url = `${GRAPH}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`;
    const r = await fetch(url);
    const t = await r.text();
    try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: { raw: t } }; }
  }
  const appToken = `${EXPECTED_APP_ID}|${APP_SECRET}`;
  const url = `${GRAPH}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(appToken)}`;
  const r = await fetch(url);
  const t = await r.text();
  try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: { raw: t } }; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Auth: aceita Bearer do usuário OU service-role (admin)
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    let callerUserId: string | null = null;
    if (token && token !== Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
      const { data: u } = await supabase.auth.getUser(token);
      callerUserId = u?.user?.id || null;
    }

    const accountsQuery = supabase
      .from("whatsapp_accounts")
      .select("id, user_id, name, phone_number_id, business_account_id, access_token, app_id, token_validity, webhook_subscribed, provider")
      .eq("provider", "meta_cloud");
    if (callerUserId) accountsQuery.eq("user_id", callerUserId);
    const { data: accounts, error } = await accountsQuery;
    if (error) throw error;

    const report: any[] = [];

    for (const acc of accounts || []) {
      const row: any = {
        account_id: acc.id,
        name: acc.name,
        phone_number_id: acc.phone_number_id,
        waba_id: acc.business_account_id,
        stored_app_id: acc.app_id,
        token_validity: acc.token_validity,
        webhook_subscribed_db: acc.webhook_subscribed,
        token_fp: tokenFp(acc.access_token),
        expected_app_id: EXPECTED_APP_ID,
        checks: {} as Record<string, any>,
        verdict: "unknown",
        issues: [] as string[],
      };

      if (!acc.access_token) {
        row.issues.push("missing_access_token");
        row.verdict = "fail";
        report.push(row);
        continue;
      }

      // 1) subscribed_apps na WABA
      const sub = await graphGet(`/${acc.business_account_id}/subscribed_apps`, acc.access_token);
      row.checks.subscribed_apps = sub;
      const subscribedAppIds: string[] = (sub.body?.data || []).map((a: any) => String(a?.whatsapp_business_api_data?.id || a?.id || ""));
      row.subscribed_app_ids = subscribedAppIds;
      const isSubscribedToExpected = subscribedAppIds.includes(EXPECTED_APP_ID);
      if (!isSubscribedToExpected) row.issues.push(`expected_app_${EXPECTED_APP_ID}_not_in_subscribed_apps`);

      // 2) WABA info
      const waba = await graphGet(`/${acc.business_account_id}?fields=id,name,owner_business_info`, acc.access_token);
      row.checks.waba_info = waba;

      // 3) debug_token -> app_id real
      const dbg = await debugToken(acc.access_token);
      row.checks.debug_token = dbg;
      const tokenAppId = dbg.body?.data?.app_id ? String(dbg.body.data.app_id) : null;
      row.token_app_id = tokenAppId;
      row.token_is_valid = dbg.body?.data?.is_valid === true;
      row.token_expires_at = dbg.body?.data?.expires_at || dbg.body?.data?.data_access_expires_at || null;
      if (tokenAppId && tokenAppId !== EXPECTED_APP_ID) {
        row.issues.push(`token_belongs_to_app_${tokenAppId}_expected_${EXPECTED_APP_ID}`);
      }

      // 4) Phone number info
      const phone = await graphGet(`/${acc.phone_number_id}?fields=id,display_phone_number,verified_name,quality_rating,messaging_limit_tier`, acc.access_token);
      row.checks.phone_number = phone;
      if (phone.status !== 200) row.issues.push(`phone_number_lookup_failed_${phone.status}`);

      // Veredito
      if (row.issues.length === 0 && isSubscribedToExpected && tokenAppId === EXPECTED_APP_ID) {
        row.verdict = "ok";
      } else if (row.issues.length === 0) {
        row.verdict = "ok_with_warnings";
      } else {
        row.verdict = "fail";
      }

      // Persist audit row
      try {
        await supabase.from("whatsapp_account_audit").insert({
          account_id: acc.id,
          user_id: acc.user_id,
          check_type: "waba_audit",
          status: row.verdict,
          details: row,
        });
      } catch (e) { console.error("audit insert failed", e); }

      report.push(row);
    }

    const summary = {
      total: report.length,
      ok: report.filter(r => r.verdict === "ok").length,
      warnings: report.filter(r => r.verdict === "ok_with_warnings").length,
      failures: report.filter(r => r.verdict === "fail").length,
      expected_app_id: EXPECTED_APP_ID,
    };

    return new Response(JSON.stringify({ ok: true, summary, accounts: report }, null, 2), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("waba-audit error:", e);
    return new Response(JSON.stringify({ ok: false, error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
