import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// TEMPORARIO: re-inscreve as WABAs do Estevao no app Prime (callback do app).
Deno.serve(async () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const sb = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: accounts } = await sb
    .from("whatsapp_accounts")
    .select("id, name, business_account_id, access_token")
    .eq("user_id", "44c78035-7cdb-4e8e-8e22-beaba931b549")
    .in("name", ["Estevao", "Estevao 2"]);

  const out: any[] = [];
  for (const acc of accounts || []) {
    const url = `https://graph.facebook.com/v21.0/${acc.business_account_id}/subscribed_apps`;
    const h = { Authorization: `Bearer ${acc.access_token}` };
    const entry: any = { name: acc.name };

    const del = await fetch(url, { method: "DELETE", headers: h });
    entry.delete = { status: del.status, body: await del.text() };

    const post = await fetch(url, { method: "POST", headers: h });
    entry.post = { status: post.status, body: await post.text() };

    const get = await fetch(url, { headers: h });
    entry.get = { status: get.status, body: await get.text() };
    out.push(entry);
  }

  return new Response(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json" } });
});
