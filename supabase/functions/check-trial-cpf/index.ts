// Confere se um CPF já usou o teste grátis, ANTES do cadastro.
//
// A trava real é a constraint UNIQUE em profiles.cpf — essa função só existe
// pra dar um erro claro ("você já testou") em vez do usuário ver a mensagem
// genérica de erro que o Supabase Auth devolve quando o trigger de criação
// falha por violar a constraint. Sem sessão ainda (roda antes do signUp), por
// isso lê com service role — profiles não é público pra outros usuários.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const cpf = String(body?.cpf || "").replace(/\D/g, "");
    if (cpf.length !== 11) return json({ error: "CPF inválido" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await admin
      .from("profiles")
      .select("user_id")
      .eq("cpf", cpf)
      .maybeSingle();
    if (error) throw error;

    return json({ available: !data });
  } catch (e) {
    console.error("check-trial-cpf:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
