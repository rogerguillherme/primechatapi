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

    let q = adminClient
      .from("whatsapp_accounts")
      .select("id, name, business_account_id, access_token, phone_number_id")
      .eq("user_id", user.id);
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

        // 1) Subscribe app to WABA  → receive webhook events
        const subUrl = `https://graph.facebook.com/v21.0/${acc.business_account_id}/subscribed_apps`;
        const subRes = await fetch(subUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${effectiveToken}` },
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

        results.push({
          account_id: acc.id,
          name: acc.name,
          ok: true,
          subscribed: subData?.success ?? true,
        });
      } catch (e: any) {
        results.push({
          account_id: acc.id,
          name: acc.name,
          ok: false,
          error: e.message,
        });
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
