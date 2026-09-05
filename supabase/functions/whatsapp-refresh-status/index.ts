import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GRAPH = "https://graph.facebook.com/v21.0";
const EXPECTED_CALLBACK = `${Deno.env.get("SUPABASE_URL")}/functions/v1/whatsapp-cloud-webhook`;

/** Resolve o token utilizável: token da conta ou da conexão OAuth ativa. */
async function resolveToken(
  admin: ReturnType<typeof createClient>,
  userId: string,
  accountToken: string | null,
): Promise<string | null> {
  if (accountToken) return accountToken;
  const { data: conn } = await admin
    .from("meta_connections")
    .select("meta_access_token")
    .eq("user_id", userId)
    .eq("status", "connected")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (conn as any)?.meta_access_token ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const { data: { user }, error: userError } = await admin.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let body: { account_id?: string } = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    let query = admin
      .from("whatsapp_accounts")
      .select("id, name, phone_number_id, business_account_id, access_token, provider")
      .eq("user_id", user.id)
      .eq("provider", "meta_cloud");

    if (body.account_id) query = query.eq("id", body.account_id);

    const { data: accounts, error: accErr } = await query;
    if (accErr) throw accErr;
    if (!accounts?.length) {
      return new Response(JSON.stringify({ error: "Conta não encontrada", results: [] }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: any[] = [];

    for (const acc of accounts as any[]) {
      const accessToken = await resolveToken(admin, user.id, acc.access_token);
      if (!accessToken || !acc.phone_number_id) {
        results.push({ id: acc.id, name: acc.name, ok: false, error: "Token ou Phone Number ID ausente" });
        continue;
      }

      try {
        // 1) Estado do número na Meta (registro, verificação, qualidade)
        const phoneRes = await fetch(
          `${GRAPH}/${acc.phone_number_id}?fields=display_phone_number,verified_name,status,code_verification_status,quality_rating,platform_type,messaging_limit_tier&access_token=${accessToken}`,
        );
        const phone = await phoneRes.json();
        if (phone?.error) throw new Error(phone.error.message || "Erro na Graph API");

        // 2) Webhook: app inscrito na WABA e callback usado
        let webhookSubscribed = false;
        let webhookStatus = "não verificado";
        if (acc.business_account_id) {
          const subRes = await fetch(
            `${GRAPH}/${acc.business_account_id}/subscribed_apps?access_token=${accessToken}`,
          );
          const sub = await subRes.json();
          const apps: any[] = sub?.data || [];
          const withOverride = apps.find(
            (a) => a?.whatsapp_business_api_data?.override_callback_uri === EXPECTED_CALLBACK,
          );
          webhookSubscribed = apps.length > 0;
          webhookStatus = sub?.error
            ? `erro: ${sub.error.message}`
            : apps.length === 0
              ? "nenhum app inscrito"
              : withOverride
                ? "inscrito (override do CRM)"
                : `inscrito (${apps.map((a) => a.whatsapp_business_api_data?.name || a.name || a.id).join(", ")})`;
        }

        const isRegistered = String(phone?.status || "").toUpperCase() === "CONNECTED";

        await admin
          .from("whatsapp_accounts")
          .update({
            display_phone_number: phone?.display_phone_number || null,
            webhook_subscribed: webhookSubscribed,
            webhook_last_status: webhookStatus,
            webhook_last_check_at: new Date().toISOString(),
            last_health_status: phone?.status || null,
            last_health_at: new Date().toISOString(),
          })
          .eq("id", acc.id)
          .eq("user_id", user.id);

        results.push({
          id: acc.id,
          name: acc.name,
          ok: true,
          registered: isRegistered,
          status: phone?.status ?? null,
          code_verification_status: phone?.code_verification_status ?? null,
          quality_rating: phone?.quality_rating ?? null,
          messaging_limit_tier: phone?.messaging_limit_tier ?? null,
          display_phone_number: phone?.display_phone_number ?? null,
          verified_name: phone?.verified_name ?? null,
          webhook_subscribed: webhookSubscribed,
          webhook_status: webhookStatus,
        });
      } catch (e) {
        results.push({
          id: acc.id,
          name: acc.name,
          ok: false,
          error: e instanceof Error ? e.message : "Erro desconhecido",
        });
      }
    }

    return new Response(JSON.stringify({ results }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("refresh status error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erro interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
