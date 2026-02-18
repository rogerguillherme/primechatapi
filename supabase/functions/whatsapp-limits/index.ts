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
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: accounts, error } = await supabase
      .from("whatsapp_accounts")
      .select("id, name, phone_number_id, access_token, is_default")
      .order("is_default", { ascending: false });

    if (error) throw error;
    if (!accounts || accounts.length === 0) {
      return new Response(JSON.stringify({ limits: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const limits = await Promise.all(
      accounts.map(async (acc) => {
        try {
          const url = `https://graph.facebook.com/v21.0/${acc.phone_number_id}?fields=messaging_limit_tier,quality_rating,display_phone_number,verified_name,current_limit`;
          const res = await fetch(url, {
            headers: { Authorization: `Bearer ${acc.access_token}` },
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
