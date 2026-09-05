// Grava credencial de API de plataforma.
//
// A gravação sai do navegador de propósito. Segredo escrito direto na tabela
// exige que o cliente tenha privilégio de escrita nela — e quem tem privilégio
// de escrita costuma acabar ganhando o de leitura junto, por descuido de uma
// policy futura. Aqui o navegador só entrega o valor; quem escreve é a função,
// com service role, depois de conferir quem pediu.
//
// Também resolve um problema prático: a policy dependia de team_access_level
// avaliada no contexto do PostgREST, e qualquer divergência ali virava
// "violates row-level security" sem dizer o motivo.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { identificarChamador } from "../_shared/caller.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** Plataformas aceitas. Lista fechada para não virar depósito de texto solto. */
const PLATAFORMAS = ["applyfy", "kiwify", "hotmart", "monetizze", "perfectpay", "cakto"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const chamador = await identificarChamador(req);
    if (!chamador.userId) return json({ error: "Não autenticado" }, 401);

    const body = await req.json().catch(() => ({}));
    const plataforma = String(body?.platform || "").toLowerCase().trim();
    const publica = String(body?.public_key || "").trim();
    const secreta = String(body?.secret_key || "").trim();

    if (!PLATAFORMAS.includes(plataforma)) {
      return json({ error: `Plataforma não suportada: ${plataforma || "(vazia)"}` }, 400);
    }
    if (!publica || !secreta) return json({ error: "Informe as duas chaves" }, 400);

    // De quem é a conta: o próprio usuário, ou o dono de quem ele é membro.
    const { data: vinculo } = await admin
      .from("team_members")
      .select("owner_id, access_level")
      .eq("member_user_id", chamador.userId)
      .order("created_at")
      .limit(1)
      .maybeSingle();

    const ownerId = vinculo?.owner_id ?? chamador.userId;
    const nivel = vinculo ? vinculo.access_level : "owner";

    // Chave de checkout dá acesso a saque. Só quem manda na conta cadastra.
    if (!["owner", "manager"].includes(String(nivel))) {
      return json({ error: "Só dono e gerente cadastram credenciais" }, 403);
    }

    const agora = new Date().toISOString();

    const { error: erroCred } = await admin.from("metrics_platform_credentials").upsert(
      {
        owner_id: ownerId,
        platform: plataforma,
        public_key: publica,
        secret_key: secreta,
        updated_at: agora,
      },
      { onConflict: "owner_id,platform" },
    );
    if (erroCred) return json({ error: erroCred.message }, 500);

    // Marca que a tela lê para saber que está configurada, já que o segredo
    // nunca volta.
    if (plataforma === "applyfy") {
      await admin
        .from("metrics_settings")
        .upsert({ owner_id: ownerId, applyfy_configured_at: agora }, { onConflict: "owner_id" });
    }

    // A resposta NUNCA devolve as chaves — nem para quem acabou de mandá-las.
    return json({ ok: true, platform: plataforma, configurado_em: agora });
  } catch (e) {
    console.error("metrik-credentials:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
