// Gera um link de checkout na ApplyFy com UTM automática por vendedor+lead,
// pra inserir na hora numa conversa do chat.
//
// utm_source = canal (ex.: "comercial")
// utm_medium = nome do vendedor (quem está logado e clicou)
// utm_content = lead_<telefone do lead>
// utm_term = <telefone do lead>
//
// A ApplyFy não tem endpoint pra listar produtos — só cria/reaproveita um
// checkout a partir de um externalId já conhecido (guardado em
// applyfy_products). Por isso o catálogo é mantido aqui, não puxado ao vivo.

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

    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const { lead_id, product_id, channel } = body;
    if (!lead_id || !product_id) return json({ error: "lead_id e product_id são obrigatórios" }, 400);

    // Dono real da conta: quem chama já é o dono, ou é membro de equipe.
    const { data: membership } = await supabase
      .from("team_members").select("owner_id").eq("member_user_id", user.id).limit(1).maybeSingle();
    const ownerId = membership?.owner_id ?? user.id;

    const { data: creds } = await supabase
      .from("applyfy_credentials").select("public_key, secret_key").eq("user_id", ownerId).maybeSingle();
    if (!creds) return json({ error: "Nenhuma credencial da ApplyFy cadastrada. Configure em Configurações." }, 400);

    const { data: product } = await supabase
      .from("applyfy_products").select("*").eq("id", product_id).eq("user_id", ownerId).eq("active", true).maybeSingle();
    if (!product) return json({ error: "Produto não encontrado" }, 404);

    const { data: lead } = await supabase.from("leads").select("id, name, phone").eq("id", lead_id).maybeSingle();
    if (!lead) return json({ error: "Lead não encontrado" }, 404);

    const leadPhone = String(lead.phone || "").replace(/\D/g, "") || lead.id;
    const vendorName =
      (user.user_metadata as any)?.full_name || (user.user_metadata as any)?.name || user.email || "vendedor";

    const payload = {
      product: {
        name: product.name,
        externalId: product.external_id,
        offer: {
          name: product.name,
          price: product.price_cents,
          offerType: "NATIONAL",
          currency: "all",
          lang: "pt-BR",
        },
      },
      settings: {
        paymentMethods: ["PIX", "BOLETO", "CREDIT_CARD"],
        acceptedDocs: ["CPF"],
        thankYouPage: "",
        askForAddress: false,
      },
      trackProps: {
        utm_source: channel || "comercial",
        utm_medium: vendorName,
        utm_content: `lead_${leadPhone}`,
        utm_term: leadPhone,
      },
    };

    const res = await fetch("https://app.applyfy.com.br/api/v1/gateway/checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-public-key": creds.public_key,
        "x-secret-key": creds.secret_key,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = data?.message || data?.error || JSON.stringify(data).slice(0, 300);
      return json({ error: `ApplyFy: ${detail}` }, res.status >= 400 && res.status < 500 ? 400 : 502);
    }

    return json({ checkoutUrl: data.checkoutUrl });
  } catch (e: any) {
    console.error("applyfy-checkout-link erro fatal:", e);
    return json({ error: e.message }, 500);
  }
});
