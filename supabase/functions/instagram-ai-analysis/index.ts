import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: { user }, error: userError } = await adminClient.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { instagramData } = await req.json();
    if (!instagramData) {
      return new Response(JSON.stringify({ error: "instagramData is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const profile = instagramData.profile || {};
    const media = (instagramData.media || []).slice(0, 12);
    const insights = instagramData.insights || {};

    // Build a summary for the AI
    const mediaSummary = media.map((p: any, i: number) => {
      const type = p.media_type || "IMAGE";
      const likes = p.like_count ?? 0;
      const comments = p.comments_count ?? 0;
      const caption = (p.caption || "").substring(0, 120);
      const date = p.timestamp ? new Date(p.timestamp).toLocaleDateString("pt-BR") : "?";
      return `${i + 1}. [${type}] ${date} — ❤️${likes} 💬${comments} — "${caption}"`;
    }).join("\n");

    const prompt = `Analise os dados deste perfil de Instagram e forneça insights estratégicos em português brasileiro.

## Dados do Perfil
- Username: @${profile.username || "?"}
- Nome: ${profile.name || "—"}
- Bio: ${profile.biography || "—"}
- Seguidores: ${profile.followers_count ?? "?"}
- Seguindo: ${profile.follows_count ?? "?"}
- Total de posts: ${profile.media_count ?? "?"}

## Insights (últimos 30 dias)
- Impressões: ${insights.impressions ?? "indisponível"}
- Alcance: ${insights.reach ?? "indisponível"}
- Visitas ao perfil: ${insights.profile_views ?? "indisponível"}

## Últimos Posts
${mediaSummary || "Sem dados de posts"}

---

Forneça uma análise completa incluindo:

1. **Tipo de Perfil**: Classifique (ex: pessoal, marca, influenciador, negócio local) e explique por quê
2. **Melhores Posts**: Identifique os top 3 posts com maior engajamento e explique o que funcionou
3. **Padrões de Engajamento**: Taxa de engajamento, horários/formatos que performam melhor
4. **Análise de Conteúdo**: Tipos de conteúdo mais eficazes (foto vs vídeo, temas recorrentes)
5. **Pontos de Melhoria**: O que pode ser otimizado para crescer
6. **Recomendações Estratégicas**: 3-5 ações concretas para melhorar resultados

Seja direto, use dados concretos dos números fornecidos, e formate com markdown.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: "Você é um especialista em marketing digital e Instagram. Analise dados de perfis e forneça insights acionáveis. Seja específico, use os números fornecidos, e dê recomendações práticas. Responda sempre em português brasileiro. Use markdown para formatar.",
          },
          { role: "user", content: prompt },
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Limite de requisições excedido. Tente novamente em alguns minutos." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos de IA esgotados." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "Erro no gateway de IA" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (error) {
    console.error("Instagram AI analysis error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message || "Erro interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
