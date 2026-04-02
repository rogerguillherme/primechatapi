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
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Extract token from URL path: /custom-webhook/{token}
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    // Path should be: functions/v1/custom-webhook/{token}
    const token = pathParts[pathParts.length - 1];

    if (!token || token === "custom-webhook") {
      return new Response(
        JSON.stringify({ error: "Token de webhook não fornecido" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Find endpoint by token
    const { data: endpoint, error: endpointError } = await adminClient
      .from("webhook_endpoints")
      .select("*")
      .eq("webhook_token", token)
      .eq("is_active", true)
      .maybeSingle();

    if (endpointError || !endpoint) {
      console.error("Webhook endpoint not found or inactive:", token);
      return new Response(
        JSON.stringify({ error: "Webhook não encontrado ou inativo" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse payload
    let payload: Record<string, unknown> = {};
    try {
      if (req.method === "POST") {
        payload = await req.json();
      }
    } catch {
      // If body is not JSON, store raw text
      try {
        const text = await req.text();
        payload = { raw: text };
      } catch {
        payload = {};
      }
    }

    const isTest = payload?._test === true;

    // Store the event using service role (bypasses RLS)
    const { error: insertError } = await adminClient.from("webhook_events").insert({
      endpoint_id: endpoint.id,
      user_id: endpoint.user_id,
      event_type: endpoint.event_type,
      payload,
      is_test: isTest,
    });

    if (insertError) {
      console.error("Failed to store webhook event:", insertError);
      return new Response(
        JSON.stringify({ error: "Falha ao registrar evento" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Webhook event received: type=${endpoint.event_type}, user=${endpoint.user_id}, test=${isTest}`);

    return new Response(
      JSON.stringify({ success: true, event_type: endpoint.event_type }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Custom webhook error:", error);
    return new Response(
      JSON.stringify({ error: "Erro interno no webhook" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
