import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface MetaTemplate {
  name: string;
  status: string;
  category: string;
  language: string;
  components?: any[];
  id: string;
}

function extractBodyText(components: any[]): string {
  const body = components?.find((c: any) => c.type === "BODY");
  return body?.text || "";
}

function extractParamCount(bodyText: string): number {
  const matches = bodyText.match(/\{\{\d+\}\}/g);
  return matches ? matches.length : 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Extract user from JWT
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user) {
      return new Response(
        JSON.stringify({ error: "Não autenticado" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { account_id } = await req.json().catch(() => ({}));

    // Get accounts to sync — filtered by authenticated user
    let accountsQuery = supabase
      .from("whatsapp_accounts")
      .select("id, name, business_account_id, access_token")
      .eq("user_id", user.id);

    if (account_id) {
      accountsQuery = accountsQuery.eq("id", account_id);
    }

    const { data: accounts, error: accErr } = await accountsQuery;
    if (accErr) throw new Error(`Failed to fetch accounts: ${accErr.message}`);
    if (!accounts?.length) {
      return new Response(
        JSON.stringify({ error: "Nenhuma conta encontrada" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const results: any[] = [];

    for (const account of accounts) {
      if (!account.business_account_id || !account.access_token) {
        results.push({
          account_id: account.id,
          account_name: account.name,
          error: "business_account_id ou access_token não configurados",
          synced: 0,
        });
        continue;
      }

      try {
        // Fetch templates from Meta API
        const metaUrl = `https://graph.facebook.com/v21.0/${account.business_account_id}/message_templates?limit=250&fields=name,status,category,language,components`;
        const metaRes = await fetch(metaUrl, {
          headers: { Authorization: `Bearer ${account.access_token}` },
        });

        const metaText = await metaRes.text();
        let metaData: any;
        try {
          metaData = JSON.parse(metaText);
        } catch {
          metaData = { error: { message: metaText } };
        }

        if (!metaRes.ok || metaData.error) {
          results.push({
            account_id: account.id,
            account_name: account.name,
            error: metaData.error?.message || `HTTP ${metaRes.status}`,
            synced: 0,
          });
          continue;
        }

        const metaTemplates: MetaTemplate[] = metaData.data || [];
        let syncedCount = 0;

        for (const mt of metaTemplates) {
          const bodyText = extractBodyText(mt.components || []);
          const paramCount = extractParamCount(bodyText);
          const defaultParams = Array.from({ length: paramCount }, (_, i) => ({
            type: "text",
            text: `{{${i + 1}}}`,
          }));

          // Upsert template by template_name + language
          const { data: existing } = await supabase
            .from("chat_templates")
            .select("id")
            .eq("template_name", mt.name)
            .eq("template_language", mt.language)
            .maybeSingle();

          const categoryMap: Record<string, string> = {
            MARKETING: "marketing",
            UTILITY: "utility",
            AUTHENTICATION: "authentication",
          };

          if (existing) {
            await supabase
              .from("chat_templates")
              .update({
                meta_status: mt.status,
                content: bodyText || existing.id ? undefined : ".",
                category: categoryMap[mt.category] || "geral",
              })
              .eq("id", existing.id);

            // Update content only if it was placeholder
            if (bodyText) {
              const { data: fullRecord } = await supabase
                .from("chat_templates")
                .select("content")
                .eq("id", existing.id)
                .single();
              if (fullRecord?.content === "." || fullRecord?.content === "..") {
                await supabase
                  .from("chat_templates")
                  .update({ content: bodyText })
                  .eq("id", existing.id);
              }
            }

            // Ensure account_templates link exists
            const { data: linkExists } = await supabase
              .from("account_templates")
              .select("id")
              .eq("account_id", account.id)
              .eq("template_id", existing.id)
              .maybeSingle();

            if (!linkExists) {
              await supabase
                .from("account_templates")
                .insert({ account_id: account.id, template_id: existing.id });
            }
          } else {
            // Create new template
            const { data: newTmpl, error: insertErr } = await supabase
              .from("chat_templates")
              .insert({
                name: mt.name,
                content: bodyText || ".",
                template_name: mt.name,
                template_language: mt.language,
                template_params: defaultParams,
                category: categoryMap[mt.category] || "geral",
                meta_status: mt.status,
              })
              .select("id")
              .single();

            if (!insertErr && newTmpl) {
              await supabase
                .from("account_templates")
                .insert({ account_id: account.id, template_id: newTmpl.id });
            }
          }
          syncedCount++;
        }

        results.push({
          account_id: account.id,
          account_name: account.name,
          total_meta: metaTemplates.length,
          synced: syncedCount,
          approved: metaTemplates.filter((t) => t.status === "APPROVED").length,
          pending: metaTemplates.filter((t) => t.status === "PENDING").length,
          rejected: metaTemplates.filter((t) => t.status === "REJECTED").length,
        });
      } catch (err) {
        results.push({
          account_id: account.id,
          account_name: account.name,
          error: err.message,
          synced: 0,
        });
      }
    }

    return new Response(
      JSON.stringify({ success: true, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Sync templates error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
