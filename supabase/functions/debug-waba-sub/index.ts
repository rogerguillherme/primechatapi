import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// TEMPORARIO: diagnostico de assinatura do app Meta.
Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const sb = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const appId = Deno.env.get("META_APP_ID");
  const appSecret = Deno.env.get("META_APP_SECRET");
  const out: any = { appId, hasAppSecret: Boolean(appSecret) };

  if (appId && appSecret) {
    const appToken = `${appId}|${appSecret}`;
    const r = await fetch(
      `https://graph.facebook.com/v21.0/${appId}/subscriptions?access_token=${encodeURIComponent(appToken)}`,
    );
    out.app_subscriptions = { status: r.status, body: await r.text() };
  }

  const { data: accounts } = await sb
    .from("whatsapp_accounts")
    .select("id, name, business_account_id, phone_number_id, app_secret, access_token")
    .eq("user_id", "44c78035-7cdb-4e8e-8e22-beaba931b549")
    .order("name");

  out.accounts = [];
  for (const acc of accounts || []) {
    const dbg = await fetch(
      `https://graph.facebook.com/v21.0/debug_token?input_token=${encodeURIComponent(acc.access_token)}&access_token=${encodeURIComponent(acc.access_token)}`,
    );
    const body = await dbg.json().catch(() => ({}));
    out.accounts.push({
      name: acc.name,
      waba: acc.business_account_id,
      has_app_secret: Boolean(acc.app_secret),
      token_app_id: body?.data?.app_id ?? null,
      token_app: body?.data?.application ?? null,
      token_type: body?.data?.type ?? null,
      expires_at: body?.data?.expires_at ?? null,
      scopes: body?.data?.scopes ?? null,
      error: body?.error?.message ?? null,
    });
  }

  return new Response(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json" } });
});
