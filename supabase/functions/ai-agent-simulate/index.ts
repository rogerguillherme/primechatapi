import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function buildSystemPrompt(agent: any, feedbacks: any[]) {
  const faqText = Array.isArray(agent.faq) && agent.faq.length
    ? agent.faq.map((f: any) => `- P: ${f.question || ""}\n  R: ${f.answer || ""}`).join("\n")
    : "";

  const feedbackText = feedbacks?.length
    ? feedbacks.map((f, i) => {
        const parts = [`📌 Treino ${i + 1}:`];
        parts.push(`Cliente disse: "${f.user_message}"`);
        if (f.bad_reply) parts.push(`❌ NÃO responda assim: "${f.bad_reply}"`);
        parts.push(`✅ Responda assim: "${f.good_reply}"`);
        if (f.note) parts.push(`💡 Observação: ${f.note}`);
        return parts.join("\n");
      }).join("\n\n")
    : "";

  return `Você é um atendente humano REAL respondendo clientes pelo WhatsApp. Jamais demonstre ser uma IA, robô ou automação.

🧠 IDENTIDADE / PERSONA:
${agent.identity || agent.name || "Atendente da empresa"}

📋 INSTRUÇÕES:
${agent.instructions || ""}

📚 CONHECIMENTO / BASE:
${agent.knowledge || ""}

🎯 DIRETRIZES:
${agent.guidelines || ""}

${faqText ? `❓ FAQ:\n${faqText}\n` : ""}

${feedbackText ? `🎓 TREINAMENTO POR FEEDBACK (siga rigorosamente o estilo dos exemplos abaixo):\n${feedbackText}\n` : ""}

✍️ COMPORTAMENTO HUMANO NATURAL:
- Escreva como uma pessoa real digitando no WhatsApp
- Mensagens curtas (1-3 frases), pode quebrar em duas mensagens curtas se fizer sentido
- Use vírgulas, "kkk", "rs", "ah", "então", "olha" quando combinar
- Erros ortográficos pequenos e ocasionais são OK (parecer humano)
- Não responda como manual; responda como gente
- Use emojis com moderação 😉
- Negrito: *texto* (UM asterisco — NUNCA **)
- Itálico: _texto_

🚫 NUNCA:
- Diga que é IA / bot / sistema / assistente virtual
- Use ** (asterisco duplo)
- Invente informações
- Misture produtos, marcas ou links de outros agentes
- Use linguagem corporativa robótica`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { agent_id, messages } = await req.json();
    if (!agent_id || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "agent_id and messages required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "AI not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Auth: validate user owns the agent
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: userData } = await supabase.auth.getUser(token);
    const userId = userData?.user?.id;
    if (!userId) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: agent } = await supabase
      .from("ai_agents")
      .select("*")
      .eq("id", agent_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (!agent) {
      return new Response(JSON.stringify({ error: "agent_not_found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: feedbacks } = await supabase
      .from("ai_agent_feedback")
      .select("user_message, bad_reply, good_reply, note")
      .eq("agent_id", agent_id)
      .order("created_at", { ascending: false })
      .limit(30);

    const systemPrompt = buildSystemPrompt(agent, feedbacks || []);
    const model = agent.ai_model || "google/gemini-3-flash-preview";

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
      }),
    });

    if (!aiResp.ok) {
      const t = await aiResp.text();
      console.error("AI gateway error:", aiResp.status, t);
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "Limite de requisições atingido. Tente novamente em instantes." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResp.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos esgotados. Adicione créditos em Configurações > Workspace > Uso." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await aiResp.json();
    let reply = data.choices?.[0]?.message?.content || "";
    reply = reply.replace(/\*\*([^*\n]+)\*\*/g, "*$1*");

    return new Response(JSON.stringify({ reply }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("simulate error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
