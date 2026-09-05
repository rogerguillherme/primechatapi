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
    const url = new URL(req.url);
    const shortCode = url.searchParams.get("c");

    if (!shortCode) {
      return new Response("Missing tracking code", { status: 400, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Find the tracking link
    const { data: link, error } = await supabase
      .from("click_tracking_links")
      .select("*")
      .eq("short_code", shortCode)
      .maybeSingle();

    if (error || !link) {
      return new Response("Link not found", { status: 404, headers: corsHeaders });
    }

    // Update click count
    await supabase
      .from("click_tracking_links")
      .update({
        click_count: (link.click_count || 0) + 1,
        clicked_at: new Date().toISOString(),
      })
      .eq("id", link.id);

    // Register campaign event
    await supabase.from("campaign_events").insert({
      campaign_id: link.campaign_id,
      lead_id: link.lead_id,
      lead_phone: link.lead_phone,
      event_type: "click",
      metadata: { url: link.original_url, short_code: shortCode },
    });

    // Redirect to original URL
    return new Response(null, {
      status: 302,
      headers: {
        ...corsHeaders,
        Location: link.original_url,
      },
    });
  } catch (error: any) {
    console.error("Track click error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
