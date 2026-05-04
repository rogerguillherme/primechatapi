import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing auth" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);

    const userId = userData.user.id;
    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const accountId = body.account_id as string | undefined;
    const limit = Math.min(Number(body.limit ?? 200), 500);

    // Get evolution account
    let account: any = null;
    if (accountId) {
      const { data } = await admin.from("whatsapp_accounts")
        .select("id, business_account_id, phone_number_id, api_key, access_token")
        .eq("user_id", userId)
        .eq("provider", "evolution")
        .eq("id", accountId)
        .maybeSingle();
      account = data;
    } else {
      // Try default first, then fall back to any Evolution account
      const { data: def } = await admin.from("whatsapp_accounts")
        .select("id, business_account_id, phone_number_id, api_key, access_token")
        .eq("user_id", userId)
        .eq("provider", "evolution")
        .eq("is_default", true)
        .maybeSingle();
      if (def) {
        account = def;
      } else {
        const { data: any1 } = await admin.from("whatsapp_accounts")
          .select("id, business_account_id, phone_number_id, api_key, access_token")
          .eq("user_id", userId)
          .eq("provider", "evolution")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        account = any1;
      }
    }
    if (!account) return json({ error: "Conta Evolution não encontrada" }, 404);

    const evoServer = (account.business_account_id || "").replace(/\/+$/, "");
    const evoKey = account.api_key || account.access_token;
    const evoInstance = account.phone_number_id;
    if (!evoServer || !evoKey || !evoInstance) return json({ error: "Conta mal configurada" }, 400);

    // Fetch leads without photo
    const { data: leads } = await admin
      .from("leads")
      .select("id, phone")
      .eq("user_id", userId)
      .is("photo_url", null)
      .limit(limit);

    if (!leads || leads.length === 0) return json({ ok: true, scanned: 0, updated: 0 });

    let updated = 0;
    for (const lead of leads) {
      const phone = (lead.phone || "").replace(/\D/g, "");
      if (!phone) continue;
      try {
        const res = await fetch(`${evoServer}/chat/fetchProfilePictureUrl/${evoInstance}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: evoKey },
          body: JSON.stringify({ number: phone }),
        });
        if (!res.ok) continue;
        const body = await res.json();
        const url = body?.profilePictureUrl || body?.profilePicUrl || body?.url;
        if (url) {
          await admin.from("leads").update({ photo_url: url }).eq("id", lead.id);
          updated++;
        }
      } catch (_) {}
    }

    return json({ ok: true, scanned: leads.length, updated });
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
});

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
