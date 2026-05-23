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

    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const {
      data: { user },
      error: userError,
    } = await adminClient.auth.getUser(token);

    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const phoneNumberId = typeof body?.phone_number_id === "string" ? body.phone_number_id.trim() : "";
    const pin = typeof body?.pin === "string" ? body.pin.trim() : "";

    if (!phoneNumberId) {
      return new Response(JSON.stringify({ error: "phone_number_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (pin && !/^\d{6}$/.test(pin)) {
      return new Response(JSON.stringify({ error: "PIN inválido. Use 6 dígitos numéricos." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: account } = await adminClient
      .from("whatsapp_accounts")
      .select("id, access_token, business_account_id")
      .eq("phone_number_id", phoneNumberId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!account) {
      return new Response(JSON.stringify({ error: "Número não encontrado na sua conta" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Prioritize OAuth token from active connection, fallback to account token
    let accessToken = account.access_token;
    const { data: metaConn } = await adminClient
      .from("meta_connections")
      .select("meta_access_token")
      .eq("user_id", user.id)
      .eq("waba_id", account.business_account_id || "")
      .eq("status", "connected")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (metaConn?.meta_access_token) {
      accessToken = metaConn.meta_access_token;
    }

    if (!accessToken) {
      return new Response(JSON.stringify({ error: "Token de acesso não encontrado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const registerPayload: Record<string, string> = {
      messaging_product: "whatsapp",
    };

    if (pin) {
      registerPayload.pin = pin;
    }

    console.log(`Registering phone ${phoneNumberId}...`);

    const registerRes = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/register`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(registerPayload),
    });

    const registerData = await registerRes.json();
    console.log(`Register response (${registerRes.status}):`, JSON.stringify(registerData));

    if (!registerRes.ok) {
      return new Response(
        JSON.stringify({
          error: registerData?.error?.message || "Falha ao registrar número na API do WhatsApp",
          error_code: registerData?.error?.code,
          details: registerData,
        }),
        {
          status: 422,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    return new Response(JSON.stringify({ success: true, data: registerData }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Register phone error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Erro interno" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
