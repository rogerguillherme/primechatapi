import { checkWebhookSecret } from "../_shared/webhook-secret.ts";

// 360dialog webhook receiver
// 360dialog forwards the same payload format used by Meta WhatsApp Cloud API
// (entry[].changes[].value with messages/statuses/metadata).
// We simply re-forward the POST body to the existing whatsapp-cloud-webhook
// handler so all routing (by phone_number_id), flow processing, chat updates,
// etc. work exactly the same way.
//
// NOTE: 360dialog does NOT do a verify-token GET handshake — only POSTs.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, d360-api-key, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Health check / browser hit
  if (req.method === "GET") {
    return new Response("d360-webhook active", {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "text/plain" },
    });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  if (!checkWebhookSecret(req, "D360_WEBHOOK_SECRET")) {
    console.error("d360-webhook: segredo ausente ou inválido");
    return new Response("Forbidden", { status: 403, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const bodyText = await req.text();
    console.log("d360-webhook payload:", bodyText.substring(0, 2000));

    // Forward to whatsapp-cloud-webhook (same format, same logic)
    const forwardUrl = `${supabaseUrl}/functions/v1/whatsapp-cloud-webhook`;
    const forwardRes = await fetch(forwardUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
        "apikey": serviceKey,
        "x-d360-forwarded": "1",
      },
      body: bodyText,
    });

    const forwardText = await forwardRes.text();
    console.log("d360-webhook forwarded status:", forwardRes.status, forwardText.substring(0, 500));

    // Always 200 to 360dialog so it doesn't retry endlessly on transient errors
    return new Response(JSON.stringify({ ok: true, forwarded_status: forwardRes.status }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("d360-webhook error:", error);
    // Still return 200 to avoid 360 retry storms; we logged the error
    return new Response(JSON.stringify({ ok: true, error: String(error) }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
