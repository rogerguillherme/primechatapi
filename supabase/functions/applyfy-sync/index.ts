// Reconfere na ApplyFy o status das vendas que já conhecemos.
//
// A API da ApplyFy tem UMA rota de consulta — busca por id, uma transação por
// vez — e a documentação pede explicitamente para não fazer polling: quem traz
// venda nova é o webhook. Então isto não descobre vendas; resolve o caso em que
// o webhook de ATUALIZAÇÃO não chegou e a venda ficou parada em "pendente" aqui
// enquanto já foi paga ou estornada lá.
//
// Por isso o alvo é fechado: só as vendas ApplyFy pendentes do nosso lado.
// Varrer tudo seria o polling que a plataforma pede para não fazer.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { identificarChamador } from "../_shared/caller.ts";
import { mapearTransacao } from "../_shared/applyfy.mjs";

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

/** Teto por execução: a consulta é uma requisição por venda. */
const MAX_POR_RODADA = 100;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const chamador = await identificarChamador(req);
    const body = await req.json().catch(() => ({}));
    const ownerId: string | null = chamador.interno ? body?.owner_id ?? null : chamador.userId;
    if (!ownerId) return json({ error: "Não autenticado" }, 401);

    // A credencial é da EMPRESA: cada cliente tem a conta ApplyFy dele. O
    // secret de ambiente fica como saída para instalação de conta única.
    const { data: cred } = await admin
      .from("metrics_platform_credentials")
      .select("public_key, secret_key")
      .eq("owner_id", ownerId)
      .eq("platform", "applyfy")
      .maybeSingle();

    const publicKey = cred?.public_key || Deno.env.get("APPLYFY_PUBLIC_KEY");
    const secretKey = cred?.secret_key || Deno.env.get("APPLYFY_SECRET_KEY");
    if (!publicKey || !secretKey) {
      return json({ error: "Credenciais da ApplyFy não configuradas para esta conta." }, 400);
    }

    // Só o que está pendente aqui. Venda já aprovada ou estornada não precisa
    // ser reconferida, e reconferir tudo viraria o polling desaconselhado.
    const { data: pendentes, error: erroBusca } = await admin
      .from("orders")
      .select("id, external_order_id, status")
      .eq("user_id", ownerId)
      .eq("platform", "applyfy")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(MAX_POR_RODADA);

    if (erroBusca) return json({ error: erroBusca.message }, 500);

    const lista = pendentes || [];
    let atualizadas = 0;
    let inalteradas = 0;
    let naoEncontradas = 0;
    let naoReconhecidas = 0;

    for (const venda of lista) {
      // Guardamos o id com prefixo para não colidir com outra plataforma; a
      // ApplyFy conhece só a parte depois dele.
      const idApplyfy = String(venda.external_order_id).replace(/^applyfy-/, "");

      const res = await fetch(
        `${BASE}/gateway/transactions?id=${encodeURIComponent(idApplyfy)}`,
        {
          headers: {
            "x-public-key": publicKey,
            "x-secret-key": secretKey,
            Accept: "application/json",
          },
        },
      );

      if (res.status === 404) {
        naoEncontradas += 1;
        continue;
      }
      if (!res.ok) {
        // Parar na primeira falha real: insistir com credencial errada ou
        // limite atingido só piora, e o motivo precisa chegar em quem clicou.
        return json(
          {
            error: `ApplyFy respondeu ${res.status}`,
            resposta: (await res.text()).slice(0, 300),
            processadas: atualizadas + inalteradas,
          },
          502,
        );
      }

      const t = mapearTransacao(await res.json().catch(() => null)) as any;
      if (!t) {
        naoReconhecidas += 1;
        continue;
      }

      if (t.status === venda.status) {
        inalteradas += 1;
        continue;
      }

      const { error } = await admin
        .from("orders")
        .update({
          status: t.status,
          amount: t.amount,
          payment_method: t.method,
          updated_at: new Date().toISOString(),
        })
        .eq("id", venda.id);
      if (!error) atualizadas += 1;
    }

    return json({
      ok: true,
      conferidas: lista.length,
      atualizadas,
      inalteradas,
      nao_encontradas: naoEncontradas,
      nao_reconhecidas: naoReconhecidas,
      teto: MAX_POR_RODADA,
    });
  } catch (e) {
    console.error("applyfy-sync:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
