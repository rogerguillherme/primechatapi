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
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user) {
      return new Response(
        JSON.stringify({ error: "Não autenticado" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const {
      template_id,
      account_id,
      name,
      language = "pt_BR",
      category = "MARKETING",
      content,
    } = body;

    if (!account_id || !name || !content) {
      return new Response(
        JSON.stringify({ error: "account_id, name e content são obrigatórios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate name format (Meta requires lowercase + underscores)
    const cleanName = name.toLowerCase().replace(/[^a-z0-9_]/g, "_");

    const { data: account, error: accErr } = await supabase
      .from("whatsapp_accounts")
      .select("id, business_account_id, access_token")
      .eq("id", account_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (accErr || !account) {
      return new Response(
        JSON.stringify({ error: "Conta WhatsApp não encontrada" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!account.business_account_id || !account.access_token) {
      return new Response(
        JSON.stringify({ error: "Conta sem business_account_id ou access_token configurados" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const categoryUpper = category.toUpperCase();
    const validCategories = ["MARKETING", "UTILITY", "AUTHENTICATION"];
    const finalCategory = validCategories.includes(categoryUpper) ? categoryUpper : "MARKETING";

    // Create template via Meta API
    const metaUrl = `https://graph.facebook.com/v21.0/${account.business_account_id}/message_templates`;
    const metaPayload = {
      name: cleanName,
      language,
      category: finalCategory,
      components: [
        {
          type: "BODY",
          text: content,
        },
      ],
    };

    const metaRes = await fetch(metaUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${account.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(metaPayload),
    });

    const metaData = await metaRes.json();

    if (!metaRes.ok || metaData.error) {
      return new Response(
        JSON.stringify({
          error: metaData.error?.message || `HTTP ${metaRes.status}`,
          details: metaData.error,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update local template with Meta data
    if (template_id) {
      await supabase
        .from("chat_templates")
        .update({
          template_name: cleanName,
          template_language: language,
          meta_status: metaData.status || "PENDING",
        })
        .eq("id", template_id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        meta_id: metaData.id,
        status: metaData.status || "PENDING",
        category: metaData.category,
        template_name: cleanName,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Create template error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
