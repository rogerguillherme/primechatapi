import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const G = "https://graph.facebook.com/v21.0";
Deno.serve(async () => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: acc } = await admin.from("whatsapp_accounts").select("*").eq("id", "407467e7-fda5-4dc9-bfe3-18975d5cad5b").single();
  const t = (acc as any).access_token;
  const out: any = { phone: null, subs: null, waba: null, debug: null };
  out.phone = await (await fetch(`${G}/${(acc as any).phone_number_id}?fields=display_phone_number,verified_name,status,code_verification_status,quality_rating,platform_type,messaging_limit_tier,is_pin_enabled&access_token=${t}`)).json();
  out.subs = await (await fetch(`${G}/${(acc as any).business_account_id}/subscribed_apps?access_token=${t}`)).json();
  out.waba = await (await fetch(`${G}/${(acc as any).business_account_id}?fields=id,name,account_review_status,owner_business_info&access_token=${t}`)).json();
  const appId = Deno.env.get("META_APP_ID"), appSecret = Deno.env.get("META_APP_SECRET");
  out.debug = await (await fetch(`${G}/debug_token?input_token=${t}&access_token=${appId}|${appSecret}`)).json();
  out.stored_app_id = (acc as any).app_id;
  return new Response(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json" } });
});
