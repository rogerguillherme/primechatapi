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
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: { user }, error: userError } = await admin.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: accounts } = await admin
      .from("whatsapp_accounts")
      .select("id, phone_number_id, access_token, provider, display_phone_number")
      .eq("user_id", user.id)
      .eq("provider", "meta_cloud");

    let updated = 0;
    const results: Array<{ id: string; display_phone_number?: string; error?: string }> = [];

    for (const acc of accounts || []) {
      if (!acc.access_token || !acc.phone_number_id) continue;
      try {
        const res = await fetch(
          `https://graph.facebook.com/v19.0/${acc.phone_number_id}?fields=display_phone_number,verified_name&access_token=${acc.access_token}`
        );
        const info = await res.json();
        const display = info?.display_phone_number as string | undefined;
        if (display && display !== acc.display_phone_number) {
          await admin
            .from("whatsapp_accounts")
            .update({ display_phone_number: display })
            .eq("id", acc.id);
          updated++;
        }
        results.push({ id: acc.id, display_phone_number: display, error: info?.error?.message });
      } catch (e) {
        results.push({ id: acc.id, error: e instanceof Error ? e.message : "erro" });
      }
    }

    return new Response(JSON.stringify({ updated, results }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("sync phone numbers error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erro interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
