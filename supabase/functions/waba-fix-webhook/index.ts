// Utilitário temporário: reinscreve a WABA de uma conta no app da Meta forçando
// o override_callback_uri para o nosso webhook. Tenta, em ordem:
//   1) token da própria conta
//   2) META_SYSTEM_USER_TOKEN (System User com whatsapp_business_management)
//   3) app access token (META_APP_ID|META_APP_SECRET)
// Também devolve a configuração de webhook no nível do app (sem expor segredos).
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CALLBACK = `${SUPABASE_URL}/functions/v1/whatsapp-cloud-webhook`;
const VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN") || "prime_chat_verify_2026";

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function graph(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: { raw: text.slice(0, 400) } };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { account_id } = await req.json().catch(() => ({}));
    if (typeof account_id !== "string" || account_id.length < 10) {
      return json({ error: "account_id obrigatório" }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: acc, error } = await admin
      .from("whatsapp_accounts")
      .select("id, name, business_account_id, phone_number_id, access_token")
      .eq("id", account_id)
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!acc?.business_account_id) return json({ error: "conta sem business_account_id" }, 404);

    const appId = Deno.env.get("META_APP_ID");
    const appSecret = Deno.env.get("META_APP_SECRET");
    const systemToken = Deno.env.get("META_SYSTEM_USER_TOKEN");
    const appToken = appId && appSecret ? `${appId}|${appSecret}` : null;

    // Webhook no nível do app (deve apontar para o nosso callback)
    const appSubs = appToken
      ? await graph(`https://graph.facebook.com/v21.0/${appId}/subscriptions?access_token=${appToken}`)
      : { status: 0, body: { error: "META_APP_ID/SECRET ausente" } };

    // Diagnóstico: a qual app pertence o token da conta e qual é o nosso app?
    const tokenDebug = appToken && acc.access_token
      ? await graph(
          `https://graph.facebook.com/v21.0/debug_token?input_token=${encodeURIComponent(acc.access_token)}&access_token=${appToken}`,
        )
      : { status: 0, body: null };
    const tokenInfo = (tokenDebug.body as any)?.data
      ? {
          app_id: (tokenDebug.body as any).data.app_id,
          application: (tokenDebug.body as any).data.application,
          is_valid: (tokenDebug.body as any).data.is_valid,
          expires_at: (tokenDebug.body as any).data.expires_at,
          scopes: (tokenDebug.body as any).data.scopes,
        }
      : (tokenDebug.body as any)?.error || null;

    const attempts: Array<Record<string, unknown>> = [];
    let ok = false;

    const candidates: Array<[string, string | null]> = [
      ["account_token", acc.access_token ?? null],
      ["system_user_token", systemToken ?? null],
      ["app_token", appToken],
    ];

    for (const [label, token] of candidates) {
      if (!token || ok) continue;
      for (const withFields of [true, false]) {
        const params = new URLSearchParams();
        params.set("override_callback_uri", CALLBACK);
        params.set("verify_token", VERIFY_TOKEN);
        if (withFields) params.set("subscribed_fields", "messages");
        const r = await graph(`https://graph.facebook.com/v21.0/${acc.business_account_id}/subscribed_apps`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        });
        attempts.push({ via: label, with_fields: withFields, status: r.status, body: r.body });
        if (r.status === 200 && !(r.body as any)?.error) {
          ok = true;
          break;
        }
      }
    }

    const finalSubs = await graph(
      `https://graph.facebook.com/v21.0/${acc.business_account_id}/subscribed_apps?access_token=${
        acc.access_token || systemToken || appToken
      }`,
    );

    await admin
      .from("whatsapp_accounts")
      .update({
        webhook_subscribed: ok,
        webhook_subscribed_at: ok ? new Date().toISOString() : null,
        webhook_last_check_at: new Date().toISOString(),
        webhook_last_status: ok ? "success (override_callback_uri)" : "falha ao inscrever",
      })
      .eq("id", acc.id);

    return json({
      ok,
      account: { id: acc.id, name: acc.name, waba_id: acc.business_account_id, phone_number_id: acc.phone_number_id },
      callback: CALLBACK,
      our_app_id: appId,
      account_token_info: tokenInfo,
      app_subscriptions: appSubs.body,
      attempts,
      subscribed_apps: finalSubs.body,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "erro" }, 500);
  }
});
