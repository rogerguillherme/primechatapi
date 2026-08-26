// Edge function: metrito-metrics
// Proxy autenticado para a API de leitura do Metrito. A API key fica só aqui —
// nunca é exposta ao front. Exige sessão de usuário válida, igual às demais
// functions do projeto (mesmo padrão de spend-metrics).
//
// Body: { action: "query" | "projects" | "connections" | "fields", ... }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BASE = "https://api.metrito.com";
const TIMEOUT_MS = 15000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // ── Fronteira de confiança 1: sessão do usuário ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing auth" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const token = authHeader.replace("Bearer ", "");

    const authClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: "Bearer " + token } },
    });
    let userId: string | null = null;
    const getClaims = (authClient.auth as any).getClaims?.bind(authClient.auth);
    if (getClaims) {
      const { data: claimsData } = await getClaims(token);
      userId = claimsData?.claims?.sub ?? null;
    }
    if (!userId) {
      const { data: userData } = await authClient.auth.getUser(token);
      userId = userData?.user?.id ?? null;
    }
    if (!userId) return json({ error: "Invalid auth" }, 401);

    const apiKey = Deno.env.get("METRITO_API_KEY");
    if (!apiKey) {
      // Feature inerte enquanto o secret não existe — não é erro de servidor.
      return json({ error: "Metrito não configurado", configured: false }, 200);
    }

    // ── Fronteira de confiança 2: input do usuário ──
    const input = await req.json().catch(() => ({}));
    const action = String(input?.action || "query");

    const metritoHeaders = {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiKey,
    };

    let url: string;
    let init: RequestInit;

    if (action === "projects") {
      url = BASE + "/v3/projects";
      init = { method: "GET", headers: metritoHeaders };
    } else if (action === "fields") {
      url = BASE + "/v3/fields";
      init = { method: "GET", headers: metritoHeaders };
    } else if (action === "connections") {
      const projectId = String(input?.project_id || Deno.env.get("METRITO_PROJECT_ID") || "");
      if (!projectId) return json({ error: "project_id obrigatório" }, 400);
      // Vai para o path da URL — só permite id opaco, sem barra/traversal.
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(projectId)) {
        return json({ error: "project_id inválido" }, 400);
      }
      url = BASE + "/v3/projects/" + projectId + "/connections";
      init = { method: "GET", headers: metritoHeaders };
    } else if (action === "query") {
      const projectId = input?.project_id || Deno.env.get("METRITO_PROJECT_ID");
      if (!projectId) {
        return json({ error: "METRITO_PROJECT_ID não configurado", configured: false }, 200);
      }
      const fields = Array.isArray(input?.fields) ? input.fields : [];
      if (fields.length === 0) return json({ error: "fields obrigatório" }, 400);

      const body: Record<string, unknown> = { project_id: projectId, fields };
      // Repassa apenas o que a API de query aceita — nada de campo solto do front.
      for (const k of ["source", "connection_ids", "time", "filters", "order", "metadata"]) {
        if (input[k] != null) body[k] = input[k];
      }
      body.limit = Math.min(Math.max(parseInt(input?.limit) || 500, 1), 50000);
      if (input?.offset != null) body.offset = Math.max(parseInt(input.offset) || 0, 0);

      url = BASE + "/v3/query";
      init = { method: "POST", headers: metritoHeaders, body: JSON.stringify(body) };
    } else {
      return json({ error: "Ação desconhecida" }, 400);
    }

    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const payload = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.error("metrito-metrics upstream error", action, res.status, JSON.stringify(payload).slice(0, 500));
      // Repassa só a mensagem do Metrito (útil para configurar), nunca a chave
      // nem headers/stack internos.
      return json(
        {
          error: (payload as any)?.message || (payload as any)?.error || "Falha ao consultar o Metrito",
          upstream_status: res.status,
        },
        res.status === 429 ? 429 : 502,
      );
    }

    return json({ ...payload, configured: true });
  } catch (err: any) {
    console.error("metrito-metrics error:", err);
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    return json({ error: timedOut ? "Metrito demorou a responder" : "Erro interno" }, timedOut ? 504 : 500);
  }
});
