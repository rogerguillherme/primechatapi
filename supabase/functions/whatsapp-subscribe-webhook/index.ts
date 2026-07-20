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
 * Without this, status updates never arrive and the UI stays stuck at "sent".
 *
 * Body: { account_id?: string }  -> if omitted, subscribes ALL user's accounts
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
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
        const subUrl = `https://graph.facebook.com/v21.0/${acc.business_account_id}/subscribed_apps`;
        const params = new URLSearchParams();
        params.set("override_callback_uri", `${supabaseUrl}/functions/v1/whatsapp-cloud-webhook`);
        params.set("verify_token", Deno.env.get("WHATSAPP_VERIFY_TOKEN") || "prime_chat_verify_2026");

        const subRes = await fetch(subUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${acc.access_token}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: params.toString(),
        });
        const subText = await subRes.text();
        let subData: any;
        try { subData = JSON.parse(subText); } catch { subData = { raw: subText }; }

        if (!subRes.ok || subData?.error) {
          results.push({
            account_id: acc.id,
            name: acc.name,
            ok: false,
            error: subData?.error?.message || `HTTP ${subRes.status}`,
            details: subData,
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
            webhook_last_status: "success (override_callback_uri)"
          })
          .eq("id", acc.id);

        results.push({
          account_id: acc.id,
          name: acc.name,
          ok: !updateErr,
          subscribed: subData?.success ?? true,
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
