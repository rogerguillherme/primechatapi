import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// TEMPORARIO: diagnostico de inscricao de WABA das contas do Estevao.
Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const sb = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { action } = await req.json().catch(() => ({ action: "get" }));

  const { data: accounts } = await sb
    .from("whatsapp_accounts")
    .select("id, name, business_account_id, phone_number_id, access_token")
    .eq("user_id", "44c78035-7cdb-4e8e-8e22-beaba931b549")
    .order("name");

  const callback = `${supabaseUrl}/functions/v1/whatsapp-cloud-webhook`;
  const { data: vt } = await sb.from("app_settings").select("value").eq("key", "whatsapp_verify_token").maybeSingle();
  const verifyToken = vt?.value?.trim() || "prime_chat_verify_2026";

  const working = (accounts || []).find((a: any) => a.name === "Estevao 1");
  const out: any[] = [];

  for (const acc of accounts || []) {
    const entry: any = { name: acc.name, waba: acc.business_account_id, phone_number_id: acc.phone_number_id };
    const url = `https://graph.facebook.com/v21.0/${acc.business_account_id}/subscribed_apps`;

    const g = await fetch(url, { headers: { Authorization: `Bearer ${acc.access_token}` } });
    entry.get_own_token = { status: g.status, body: await g.text() };

    if (action === "subscribe" && acc.name !== "Estevao 1" && working) {
      for (const [label, tok] of [["own", acc.access_token], ["estevao1", working.access_token]] as const) {
        const body = new URLSearchParams({
          override_callback_uri: callback,
          verify_token: verifyToken,
          subscribed_fields: "messages",
        });
        const p = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        });
        entry[`post_with_${label}`] = { status: p.status, body: await p.text() };
      }
      const g2 = await fetch(url, { headers: { Authorization: `Bearer ${acc.access_token}` } });
      entry.get_after = { status: g2.status, body: await g2.text() };
    }
    out.push(entry);
  }

  return new Response(JSON.stringify({ callback, out }, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
});
