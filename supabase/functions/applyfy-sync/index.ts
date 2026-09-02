// Puxa transações da ApplyFy e concilia com `orders`.
//
// O webhook é quem traz a venda em tempo real; isto aqui é a CONFERÊNCIA.
// Webhook perde evento em pico — já aconteceu com a Hubla neste projeto — e
// puxar por API é como se descobre o que faltou. Rodar isto de tempos em
// tempos fecha o buraco sem depender da plataforma reenviar.
//
// As chaves vivem em secrets, nunca no repositório: segredo em git fica no
// histórico para sempre, mesmo depois de removido.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { identificarChamador } from "../_shared/caller.ts";
import { mapearTransacao, listaDeTransacoes } from "../_shared/applyfy.mjs";
import { normalizeTypedPhone } from "../_shared/phone.mjs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const BASE = "https://app.applyfy.com.br/api/v1";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const publicKey = Deno.env.get("APPLYFY_PUBLIC_KEY");
    const secretKey = Deno.env.get("APPLYFY_SECRET_KEY");
    if (!publicKey || !secretKey) {
      return json(
        { error: "Configure os secrets APPLYFY_PUBLIC_KEY e APPLYFY_SECRET_KEY." },
        400,
      );
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Esta função grava venda. Sem porta, qualquer pessoa com a URL mandaria
    // faturamento para dentro da conta de um cliente.
    const chamador = await identificarChamador(req);
    const body = await req.json().catch(() => ({}));
    const ownerId: string | null = chamador.interno
      ? body?.owner_id ?? null
      : chamador.userId;
    if (!ownerId) return json({ error: "Não autenticado" }, 401);

    // O caminho da listagem fica em secret porque é a única coisa da API que
    // ainda não está confirmada na documentação. Trocar uma string não deve
    // exigir deploy de código.
    const caminho = Deno.env.get("APPLYFY_TRANSACTIONS_PATH") || "/transactions";
    const desde: string =
      body?.desde || new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);

    const url = `${BASE}${caminho}?start_date=${desde}&per_page=200`;
    const res = await fetch(url, {
      headers: {
        "x-public-key": publicKey,
        "x-secret-key": secretKey,
        Accept: "application/json",
      },
    });

    const texto = await res.text();
    if (!res.ok) {
      // O corpo da ApplyFy é o que diz se o problema é chave, caminho ou
      // permissão. Devolver só o status obrigaria a abrir o log para saber.
      return json(
        {
          error: `ApplyFy respondeu ${res.status}`,
          url,
          resposta: texto.slice(0, 400),
        },
        502,
      );
    }

    let corpo: unknown = null;
    try {
      corpo = JSON.parse(texto);
    } catch {
      return json({ error: "Resposta não era JSON", resposta: texto.slice(0, 300) }, 502);
    }

    const transacoes = listaDeTransacoes(corpo);
    let gravadas = 0;
    let semTelefone = 0;
    let ignoradas = 0;

    for (const bruta of transacoes as any[]) {
      const t = mapearTransacao(bruta) as any;
      if (!t) {
        ignoradas += 1;
        continue;
      }

      // A venda precisa de um lead: é dele que sai o vendedor, e sem vendedor
      // ela não entra em comissão nenhuma.
      const telefone = normalizeTypedPhone(t.phone) as string;
      if (!telefone) {
        semTelefone += 1;
        continue;
      }

      let leadId: string | null = null;
      const { data: existente } = await admin
        .from("leads")
        .select("id")
        .eq("phone", telefone)
        .eq("user_id", ownerId)
        .limit(1)
        .maybeSingle();

      if (existente) {
        leadId = existente.id;
      } else {
        const { data: novo } = await admin
          .from("leads")
          .insert({
            name: t.name || `ApplyFy ${telefone}`,
            phone: telefone,
            email: t.email,
            origin: "applyfy",
            user_id: ownerId,
          })
          .select("id")
          .maybeSingle();
        leadId = novo?.id ?? null;
      }

      if (!leadId) continue;

      // Upsert pelo id da ApplyFy: rodar a conciliação duas vezes não pode
      // duplicar faturamento, e é justamente para rodar repetido que ela existe.
      const { error } = await admin.from("orders").upsert(
        {
          lead_id: leadId,
          user_id: ownerId,
          external_order_id: `applyfy-${t.externalId}`,
          amount: t.amount,
          status: t.status,
          platform: "applyfy",
          payment_method: t.method,
          created_at: t.createdAt || new Date().toISOString(),
          webhook_payload: bruta,
        },
        { onConflict: "external_order_id" },
      );
      if (!error) gravadas += 1;
    }

    return json({
      ok: true,
      recebidas: (transacoes as any[]).length,
      gravadas,
      ignoradas,
      sem_telefone: semTelefone,
      desde,
    });
  } catch (e) {
    console.error("applyfy-sync:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
