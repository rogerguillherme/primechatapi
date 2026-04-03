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
    const metaAppId = Deno.env.get("META_APP_ID")!;
    const metaAppSecret = Deno.env.get("META_APP_SECRET")!;

    // Authenticate user
    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
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

    // Get user's active meta connection to use the access token
    const { data: connection } = await adminClient
      .from("meta_connections")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "connected")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!connection) {
      return new Response(
        JSON.stringify({ error: "Nenhuma conexão Meta ativa encontrada", wabas: [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const accessToken = connection.meta_access_token;

    // Get all WABAs via debug_token
    const debugRes = await fetch(
      `https://graph.facebook.com/v19.0/debug_token?input_token=${accessToken}&access_token=${metaAppId}|${metaAppSecret}`
    );
    const debugData = await debugRes.json();

    const granularScopes = debugData?.data?.granular_scopes || [];
    const whatsappScope = granularScopes.find(
      (s: any) => s.scope === "whatsapp_business_management"
    );
    const wabaIds = whatsappScope?.target_ids || [];

    // Also try via businesses
    const bizRes = await fetch(
      `https://graph.facebook.com/v19.0/me/businesses?access_token=${accessToken}`
    );
    const bizData = await bizRes.json();

    const extraWabaIds: string[] = [];
    if (bizData?.data?.length > 0) {
      for (const biz of bizData.data) {
        const owned = await fetch(
          `https://graph.facebook.com/v19.0/${biz.id}/owned_whatsapp_business_accounts?access_token=${accessToken}`
        );
        const ownedData = await owned.json();
        if (ownedData?.data) {
          for (const w of ownedData.data) {
            if (!wabaIds.includes(w.id) && !extraWabaIds.includes(w.id)) {
              extraWabaIds.push(w.id);
            }
          }
        }
      }
    }

    const allWabaIds = [...new Set([...wabaIds, ...extraWabaIds])];

    // Fetch details for each WABA
    const wabas: any[] = [];

    for (const wabaId of allWabaIds) {
      // Get WABA details
      const wabaRes = await fetch(
        `https://graph.facebook.com/v19.0/${wabaId}?fields=id,name,currency,timezone_id,message_template_namespace,account_review_status,on_behalf_of_business_info,primary_funding_id&access_token=${accessToken}`
      );
      const wabaInfo = await wabaRes.json();

      // Get phone numbers with maximum fields
      const phonesRes = await fetch(
        `https://graph.facebook.com/v19.0/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,code_verification_status,quality_rating,platform_type,throughput,status,name_status,new_name_status,last_onboarded_time,messaging_limit_tier,is_official_business_account,is_pin_enabled,certificate,new_certificate&access_token=${accessToken}`
      );
      const phonesData = await phonesRes.json();

      // Check which numbers are already registered in our system
      const phoneNumbers = phonesData?.data || [];
      const phoneNumberIds = phoneNumbers.map((p: any) => p.id);
      
      const { data: existingAccounts } = await adminClient
        .from("whatsapp_accounts")
        .select("phone_number_id")
        .in("phone_number_id", phoneNumberIds.length > 0 ? phoneNumberIds : ["__none__"]);

      const registeredIds = new Set((existingAccounts || []).map((a: any) => a.phone_number_id));

      wabas.push({
        id: wabaId,
        name: wabaInfo.name || wabaId,
        currency: wabaInfo.currency,
        timezone_id: wabaInfo.timezone_id,
        account_review_status: wabaInfo.account_review_status,
        message_template_namespace: wabaInfo.message_template_namespace,
        on_behalf_of_business_info: wabaInfo.on_behalf_of_business_info,
        phone_numbers: phoneNumbers.map((p: any) => ({
          id: p.id,
          display_phone_number: p.display_phone_number,
          verified_name: p.verified_name,
          code_verification_status: p.code_verification_status,
          quality_rating: p.quality_rating,
          platform_type: p.platform_type,
          throughput: p.throughput,
          status: p.status,
          name_status: p.name_status,
          new_name_status: p.new_name_status,
          last_onboarded_time: p.last_onboarded_time,
          messaging_limit_tier: p.messaging_limit_tier,
          is_official_business_account: p.is_official_business_account,
          is_pin_enabled: p.is_pin_enabled,
          certificate: p.certificate,
          new_certificate: p.new_certificate,
          is_registered: registeredIds.has(p.id),
        })),
      });
    }

    return new Response(
      JSON.stringify({ wabas }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error listing Meta numbers:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erro interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
