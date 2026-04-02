import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const metaAppId = Deno.env.get("META_APP_ID")!;
    const metaAppSecret = Deno.env.get("META_APP_SECRET")!;

    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: { user }, error: userError } = await adminClient.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = user.id;

    const { code, redirect_uri } = await req.json();
    if (!code || !redirect_uri) {
      return new Response(JSON.stringify({ error: "code and redirect_uri are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Step 1: Exchange code for access_token
    const tokenUrl = `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${metaAppId}&redirect_uri=${encodeURIComponent(redirect_uri)}&client_secret=${metaAppSecret}&code=${encodeURIComponent(code)}`;
    const tokenRes = await fetch(tokenUrl);
    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      console.error("Token exchange failed:", tokenData);
      return new Response(JSON.stringify({ error: "Falha ao obter token da Meta", details: tokenData }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = tokenData.access_token;

    // Step 2: Get WhatsApp Business Accounts
    const meRes = await fetch(`https://graph.facebook.com/v19.0/me?fields=id,name&access_token=${accessToken}`);
    const meData = await meRes.json();

    // Try to get WABA via debug_token or shared WABAs
    const wabaRes = await fetch(
      `https://graph.facebook.com/v19.0/me/businesses?access_token=${accessToken}`
    );
    const wabaData = await wabaRes.json();

    // Get shared WABA IDs
    let wabaId: string | null = null;
    let phoneNumberId: string | null = null;
    let phoneNumber: string | null = null;

    // Try direct approach: list WABAs the token has access to
    const sharedWabaRes = await fetch(
      `https://graph.facebook.com/v19.0/debug_token?input_token=${accessToken}&access_token=${metaAppId}|${metaAppSecret}`
    );
    const debugData = await sharedWabaRes.json();
    console.log("Debug token data:", JSON.stringify(debugData));

    const granularScopes = debugData?.data?.granular_scopes || [];
    const whatsappScope = granularScopes.find(
      (s: any) => s.permission === "whatsapp_business_management"
    );
    const targetWabaIds = whatsappScope?.target_ids || [];

    if (targetWabaIds.length > 0) {
      wabaId = targetWabaIds[0];
    }

    // Fallback: try fetching WABAs from businesses
    if (!wabaId && wabaData?.data?.length > 0) {
      for (const biz of wabaData.data) {
        const bizWabaRes = await fetch(
          `https://graph.facebook.com/v19.0/${biz.id}/owned_whatsapp_business_accounts?access_token=${accessToken}`
        );
        const bizWabaData = await bizWabaRes.json();
        if (bizWabaData?.data?.length > 0) {
          wabaId = bizWabaData.data[0].id;
          break;
        }
      }
    }

    if (!wabaId) {
      return new Response(
        JSON.stringify({
          error: "Nenhuma conta WhatsApp Business encontrada. Certifique-se de que sua conta Meta tem acesso a uma conta WhatsApp Business.",
          debug: { me: meData, businesses: wabaData?.data, scopes: granularScopes },
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 3: Get phone numbers
    const phonesRes = await fetch(
      `https://graph.facebook.com/v19.0/${wabaId}/phone_numbers?access_token=${accessToken}`
    );
    const phonesData = await phonesRes.json();

    if (phonesData?.data?.length > 0) {
      phoneNumberId = phonesData.data[0].id;
      phoneNumber = phonesData.data[0].display_phone_number;
    } else {
      return new Response(
        JSON.stringify({ error: "Nenhum número de telefone encontrado na conta WhatsApp Business." }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 4: Save connection using service role (adminClient already created above)

    // Upsert: update existing or create new
    const { data: existing } = await adminClient
      .from("meta_connections")
      .select("id")
      .eq("user_id", userId)
      .eq("waba_id", wabaId)
      .maybeSingle();

    if (existing) {
      await adminClient
        .from("meta_connections")
        .update({
          meta_access_token: accessToken,
          phone_number_id: phoneNumberId,
          phone_number: phoneNumber,
          status: "connected",
        })
        .eq("id", existing.id);
    } else {
      await adminClient.from("meta_connections").insert({
        user_id: userId,
        meta_access_token: accessToken,
        waba_id: wabaId,
        phone_number_id: phoneNumberId,
        phone_number: phoneNumber,
        status: "connected",
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        phone_number: phoneNumber,
        waba_id: wabaId,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Meta OAuth callback error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
