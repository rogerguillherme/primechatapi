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

    const authHeader = req.headers.get("authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: { user }, error: userError } = await adminClient.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const phone_number_id = body.phone_number_id;
    const pin = body.pin || "123456";

    if (!phone_number_id) {
      return new Response(JSON.stringify({ error: "phone_number_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Try to get access token from meta_connections first (longer-lived), then whatsapp_accounts
    let accessToken: string | null = null;

    const { data: metaConn } = await adminClient
      .from("meta_connections")
      .select("meta_access_token")
      .eq("user_id", user.id)
      .eq("status", "connected")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (metaConn?.meta_access_token) {
      accessToken = metaConn.meta_access_token;
    } else {
      const { data: account } = await adminClient
        .from("whatsapp_accounts")
        .select("access_token")
        .eq("phone_number_id", phone_number_id)
        .eq("user_id", user.id)
        .maybeSingle();

      if (account?.access_token) {
        accessToken = account.access_token;
      }
    }

    if (!accessToken) {
      return new Response(JSON.stringify({ error: "Nenhum token de acesso encontrado. Reconecte sua conta Meta." }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Registering phone ${phone_number_id} with WhatsApp Cloud API...`);

    // Register the phone number with WhatsApp Cloud API
    const registerRes = await fetch(
      `https://graph.facebook.com/v19.0/${phone_number_id}/register`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          pin: pin,
        }),
      }
    );

    const registerData = await registerRes.json();
    console.log(`Register response (${registerRes.status}):`, JSON.stringify(registerData));

    if (!registerRes.ok) {
      return new Response(
        JSON.stringify({ 
          error: registerData?.error?.message || "Falha ao registrar número na API do WhatsApp",
          error_code: registerData?.error?.code,
          details: registerData 
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, data: registerData }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Register phone error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erro interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
