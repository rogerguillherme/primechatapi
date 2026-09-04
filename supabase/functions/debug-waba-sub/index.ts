import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// TEMPORARIO: descobre WABAs/numeros visiveis pelo system user do app CRM.
Deno.serve(async () => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: acc } = await sb
    .from("whatsapp_accounts")
    .select("access_token")
    .eq("name", "Estevao 1")
    .eq("user_id", "44c78035-7cdb-4e8e-8e22-beaba931b549")
    .maybeSingle();
  const tok = acc!.access_token as string;
  const h = { Authorization: `Bearer ${tok}` };
  const j = async (u: string) => {
    const r = await fetch(u, { headers: h });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };

  const out: any = {};
  out.businesses = await j("https://graph.facebook.com/v21.0/me/businesses?fields=id,name&limit=25");
  out.wabas = [];
  for (const b of out.businesses.body?.data || []) {
    const owned = await j(`https://graph.facebook.com/v21.0/${b.id}/owned_whatsapp_business_accounts?fields=id,name&limit=50`);
    const client = await j(`https://graph.facebook.com/v21.0/${b.id}/client_whatsapp_business_accounts?fields=id,name&limit=50`);
    const list = [...(owned.body?.data || []), ...(client.body?.data || [])];
    for (const w of list) {
      const nums = await j(`https://graph.facebook.com/v21.0/${w.id}/phone_numbers?fields=id,display_phone_number,verified_name&limit=50`);
      out.wabas.push({ business: b.name, business_id: b.id, waba: w.id, waba_name: w.name, numbers: nums.body?.data || nums.body });
    }
  }
  return new Response(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json" } });
});
