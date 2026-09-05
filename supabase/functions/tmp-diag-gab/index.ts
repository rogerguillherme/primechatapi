import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const G = "https://graph.facebook.com/v21.0";
Deno.serve(async () => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: acc } = await admin.from("whatsapp_accounts").select("*").eq("id", "407467e7-fda5-4dc9-bfe3-18975d5cad5b").single();
  const t = (acc as any).access_token;
  const reg = await fetch(`${G}/${(acc as any).phone_number_id}/register`, {
    method: "POST",
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", pin: "123456" }),
  });
  const regJson = await reg.json();
  const phone = await (await fetch(`${G}/${(acc as any).phone_number_id}?fields=status,display_phone_number,code_verification_status&access_token=${t}`)).json();
  return new Response(JSON.stringify({ status: reg.status, regJson, phone }, null, 2), { headers: { "Content-Type": "application/json" } });
});
