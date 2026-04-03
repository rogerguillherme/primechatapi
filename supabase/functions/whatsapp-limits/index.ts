import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader =
      req.headers.get("authorization") ??
      req.headers.get("Authorization") ??
      "";

    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: { user }, error: userError } = await adminClient.auth.getUser(token);

    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = user.id;

    const { data: accounts, error } = await adminClient
      .from("whatsapp_accounts")
      .select("id, name, phone_number_id, access_token, is_default, business_account_id")
      .eq("user_id", userId)
      .order("is_default", { ascending: false });

    if (error) throw error;
    if (!accounts || accounts.length === 0) {
      return new Response(JSON.stringify({ limits: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch active meta_connections to use their (potentially fresher) tokens
    const { data: metaConns } = await adminClient
      .from("meta_connections")
      .select("waba_id, meta_access_token")
      .eq("user_id", userId)
      .eq("status", "connected");

    // Build a map of waba_id -> meta_access_token
    const metaTokenByWaba: Record<string, string> = {};
    if (metaConns) {
      for (const mc of metaConns) {
        metaTokenByWaba[mc.waba_id] = mc.meta_access_token;
      }
    }

    const limits = await Promise.all(
      accounts.map(async (acc) => {
        try {
          // Prefer meta_connections token over stored access_token
          const effectiveToken =
            (acc.business_account_id && metaTokenByWaba[acc.business_account_id]) ||
            acc.access_token;

          const url = `https://graph.facebook.com/v21.0/${acc.phone_number_id}?fields=messaging_limit_tier,quality_rating,display_phone_number,verified_name`;
          const res = await fetch(url, {
            headers: { Authorization: `Bearer ${effectiveToken}` },
          });
          const data = await res.json();
          console.log(`WhatsApp limits for ${acc.name}:`, JSON.stringify(data));

          return {
            account_id: acc.id,
            account_name: acc.name,
            is_default: acc.is_default,
            phone: data.display_phone_number || null,
            verified_name: data.verified_name || null,
            quality_rating: data.quality_rating || null,
            messaging_limit_tier: data.messaging_limit_tier || null,
            current_limit: data.current_limit || null,
            error: data.error ? data.error.message : null,
          };
        } catch (e) {
          return {
            account_id: acc.id,
            account_name: acc.name,
            is_default: acc.is_default,
            error: e.message,
          };
        }
      })
    );

    return new Response(JSON.stringify({ limits }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error fetching limits:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
