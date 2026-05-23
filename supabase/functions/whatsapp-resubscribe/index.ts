// Re-subscribe a single WhatsApp account's WABA to our app webhooks.
// Uses the per-account access_token. Updates webhook_* fields and audits.

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) return json(401, { error: "Unauthorized" });
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    const { data: { user }, error: uErr } = await admin.auth.getUser(jwt);
    if (uErr || !user) return json(401, { error: "Unauthorized" });

    const { account_id } = await req.json().catch(() => ({}));
    if (!account_id) return json(400, { error: "account_id_required" });

    const { data: acc } = await admin
      .from("whatsapp_accounts")
      .select("id, user_id, access_token, business_account_id, provider")
      .eq("id", account_id)
      .maybeSingle();

    if (!acc) return json(404, { error: "account_not_found" });
    if (acc.user_id !== user.id) return json(403, { error: "account_forbidden" });
    if (acc.provider !== "meta_cloud") return json(400, { error: "only_meta_cloud_supported" });
    if (!acc.business_account_id || !acc.access_token) {
      return json(422, { error: "account_missing_waba_or_token" });
    }

    const nowIso = new Date().toISOString();
    const subRes = await fetch(`${GRAPH}/${acc.business_account_id}/subscribed_apps`, {
      method: "POST",
      headers: { Authorization: `Bearer ${acc.access_token}` },
    });
    const subBody = await subRes.json().catch(() => ({}));
    const ok = subRes.ok && (subBody?.success === true || subBody?.success === undefined);

    await admin
      .from("whatsapp_accounts")
      .update({
        webhook_subscribed: ok,
        webhook_subscribed_at: ok ? nowIso : null,
        webhook_last_check_at: nowIso,
        webhook_last_status: ok ? "ok" : `error:${subRes.status}`,
        updated_at: nowIso,
      })
      .eq("id", acc.id);

    await admin.from("whatsapp_account_audit").insert({
      account_id: acc.id,
      user_id: acc.user_id,
      event: "subscribed_apps",
      status: ok ? "ok" : "error",
      details: { http: subRes.status, body: subBody, triggered_by: "manual_resubscribe" },
    });

    return json(ok ? 200 : 422, { ok, http: subRes.status, body: subBody });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro interno";
    console.error("whatsapp-resubscribe error:", error);
    return json(500, { error: message });
  }
});
