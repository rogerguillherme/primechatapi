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

    const mediaSummary = media.map((p: any, i: number) => {
      const type = p.media_type || "IMAGE";
      const likes = p.like_count ?? 0;
      const comments = p.comments_count ?? 0;
      const caption = (p.caption || "").substring(0, 120);
      const date = p.timestamp ? new Date(p.timestamp).toLocaleDateString("pt-BR") : "?";
      return `${i + 1}. [${type}] ${date} — ❤️${likes} 💬${comments} — "${caption}"`;
    }).join("\n");

    const totalLikes = media.reduce((s: number, p: any) => s + (p.like_count ?? 0), 0);
    const totalComments = media.reduce((s: number, p: any) => s + (p.comments_count ?? 0), 0);
    const followers = profile.followers_count || 0;
    const avgEng = media.length && followers
      ? (((totalLikes + totalComments) / media.length / followers) * 100).toFixed(2)
      : "0";
    const followRatio = profile.follows_count
      ? (followers / profile.follows_count).toFixed(2)
      : "?";

    const sortedMedia = [...media].sort((a: any, b: any) =>
      ((b.like_count || 0) + (b.comments_count || 0)) - ((a.like_count || 0) + (a.comments_count || 0))
    );
    const topPosts = sortedMedia.slice(0, 3).map((p: any, i: number) => {
      const eng = followers ? (((p.like_count || 0) + (p.comments_count || 0)) / followers * 100).toFixed(2) : "0";
      return `Top ${i + 1}: [${p.media_type}] ❤️${p.like_count || 0} 💬${p.comments_count || 0} (${eng}%) — "${(p.caption || "").substring(0, 100)}"`;
    }).join("\n");

    const prompt = `Você é a **Prime IA**, consultora sênior de marketing digital especializada em Instagram. Faça uma análise profunda, crítica e acionável deste perfil.

## 📊 PERFIL
- @${profile.username || "?"} ${profile.name ? `(${profile.name})` : ""}
- Bio: ${profile.biography || "(sem bio)"}
- Seguidores: ${followers.toLocaleString("pt-BR")}
- Seguindo: ${(profile.follows_count || 0).toLocaleString("pt-BR")}
- Posts totais: ${profile.media_count ?? "?"}
- Razão Seguidores/Seguindo: ${followRatio}

## 📈 PERFORMANCE (últimos ${media.length} posts)
- Engajamento médio: ${avgEng}%
- Total de curtidas: ${totalLikes.toLocaleString("pt-BR")}
- Total de comentários: ${totalComments.toLocaleString("pt-BR")}
- Impressões 30d: ${insights.impressions ?? "indisponível"}
- Alcance 30d: ${insights.reach ?? "indisponível"}
- Visitas ao perfil 30d: ${insights.profile_views ?? "indisponível"}

## 🏆 TOP POSTS
${topPosts || "Sem dados suficientes"}

## 📝 ÚLTIMOS POSTS
${mediaSummary || "Sem posts"}

---

Entregue uma análise estruturada **em português brasileiro**, formatada em markdown, com EXATAMENTE estas seções:

## 🎯 Diagnóstico do Perfil
Em 1 parágrafo direto: que tipo de perfil é (pessoal, marca, criador, negócio local), nicho aparente, maturidade da conta e nota geral de 0 a 10 com justificativa.

## 🏆 O que está funcionando
3 a 5 pontos fortes específicos baseados nos dados reais (ex: "carrosséis com 4.2% de engajamento"). Use números do perfil.

## ⚠️ Problemas críticos
3 a 5 fraquezas concretas que estão limitando o crescimento. Seja direto e franco.

## 💡 Estratégia de Conteúdo (próximos 30 dias)
Plano prático com **pilares de conteúdo** (3 temas), **frequência ideal**, **formatos prioritários** (com base na performance real) e **horários sugeridos**.

## 🚀 5 Ações Imediatas
Lista numerada com ações executáveis HOJE — cada uma com objetivo claro e métrica esperada.

## 📌 Otimização da Bio
Sugira uma nova bio (máx 150 caracteres) e CTA para link.

Seja específico, use números do perfil, sem clichês. Tom de consultoria premium.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          {
            role: "system",
            content: "Você é a Prime IA, consultora sênior de marketing digital com 10+ anos de experiência especializada em Instagram. Tom profissional, direto, baseado em dados. Nunca invente números — use apenas os fornecidos. Sempre em português brasileiro, formatado em markdown elegante.",
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
