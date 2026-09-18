// Recebe as notificações de venda da ApplyFy (Configurações > Webhooks no
// painel dela) e grava em applyfy_sales, com as UTMs de trackProps já
// separadas em colunas.
//
// Endpoint público — não tem JWT nosso pra validar quem chama. A própria
// ApplyFy documenta que valida pelo `token` que vem no corpo do payload,
// gerado quando o webhook é criado; comparamos contra applyfy_credentials
// pra descobrir de qual conta é a venda.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const payload = await req.json().catch(() => null);
    if (!payload) return json({ error: "Body inválido" }, 400);

    const token = payload.token;
    if (!token) return json({ error: "Sem token de validação" }, 401);

    const { data: account } = await supabase
      .from("applyfy_credentials").select("user_id").eq("webhook_token", token).maybeSingle();
    if (!account) return json({ error: "Token não reconhecido" }, 401);

    const tx = payload.transaction || {};
    const transactionId = tx.id;
    if (!transactionId) return json({ error: "transaction.id ausente" }, 400);

    const track = tx.trackProps || {};
    const client = payload.client || {};
    const item = Array.isArray(tx.orderItems) ? tx.orderItems[0] : null;

    const { error } = await supabase.from("applyfy_sales").upsert({
      user_id: account.user_id,
      transaction_id: transactionId,
      event: payload.event || null,
      status: tx.status || "PENDING",
      amount_cents: tx.amount ?? 0,
      payment_method: tx.paymentMethod || null,
      product_name: item?.product?.name || null,
      product_external_id: item?.product?.externalId || null,
      client_name: client.name || null,
      client_phone: client.phone || null,
      client_email: client.email || null,
      utm_source: track.utm_source || null,
      utm_medium: track.utm_medium || null,
      utm_campaign: track.utm_campaign || null,
      utm_content: track.utm_content || null,
      utm_term: track.utm_term || null,
      raw_payload: payload,
      payed_at: tx.payedAt || (tx.status === "COMPLETED" ? new Date().toISOString() : null),
    }, { onConflict: "user_id,transaction_id" });

    if (error) {
      console.error("applyfy-webhook upsert error:", error.message);
      return json({ error: error.message }, 500);
    }

    return json({ ok: true });
  } catch (e: any) {
    console.error("applyfy-webhook erro fatal:", e);
    return json({ error: e.message }, 500);
  }
});
