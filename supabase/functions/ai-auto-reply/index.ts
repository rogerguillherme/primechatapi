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
    const { lead_id, message, account_id } = await req.json();
    if (!lead_id || !message) {
      return new Response(JSON.stringify({ error: "lead_id and message required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (!LOVABLE_API_KEY) {
      console.error("LOVABLE_API_KEY not configured");
      return new Response(JSON.stringify({ error: "AI not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check AI auto-reply mode: "off" | "all" | "selected"
    const { data: modeRow } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "ai_auto_reply_mode")
      .maybeSingle();

    // Backwards compat: if old "ai_auto_reply_enabled" was true and no mode set => "all"
    let mode = modeRow?.value as string | undefined;
    if (!mode) {
      const { data: legacy } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "ai_auto_reply_enabled")
        .maybeSingle();
      mode = legacy?.value === "true" ? "all" : "off";
    }

    if (mode === "off") {
      return new Response(JSON.stringify({ skipped: "ai_disabled" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // In "selected" mode, only respond when the lead has ai_enabled = true
    if (mode === "selected") {
      const { data: leadFlag } = await supabase
        .from("leads")
        .select("ai_enabled")
        .eq("id", lead_id)
        .maybeSingle();
      if (!leadFlag?.ai_enabled) {
        return new Response(JSON.stringify({ skipped: "lead_ai_off" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Get AI config from app_settings
    const { data: configRows } = await supabase
      .from("app_settings")
      .select("key, value")
      .in("key", [
        "ai_company_name",
        "ai_company_description",
        "ai_products_services",
        "ai_custom_instructions",
      ]);

    const config: Record<string, string> = {};
    for (const row of configRows || []) {
      config[row.key] = row.value;
    }

    // Get lead info
    const { data: lead } = await supabase
      .from("leads")
      .select("id, name, phone")
      .eq("id", lead_id)
      .single();

    if (!lead) {
      return new Response(JSON.stringify({ error: "Lead not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get recent conversation history (last 20 messages)
    const { data: history } = await supabase
      .from("chat_messages")
      .select("direction, content, created_at")
      .eq("lead_id", lead_id)
      .order("created_at", { ascending: false })
      .limit(20);

    const conversationHistory = (history || [])
      .reverse()
      .map((m) => ({
        role: m.direction === "inbound" ? "user" as const : "assistant" as const,
        content: m.content,
      }));

    // Build system prompt
    const companyName = config.ai_company_name || "Nossa Empresa";
    const companyDesc = config.ai_company_description || "";
    const products = config.ai_products_services || "";
    const customInstructions = config.ai_custom_instructions || "";

    const systemPrompt = `Você é um atendente humano de verdade da empresa, respondendo clientes pelo WhatsApp.
Sua missão é parecer 100% humano — jamais demonstre ser uma IA, robô ou automação.

🎯 OBJETIVO PRINCIPAL:
- Entender o cliente
- Responder dúvidas
- Conduzir a conversa para venda ou solução
- Manter a conversa fluindo de forma simples e clara

🧠 SOBRE A EMPRESA:
Nome: ${companyName}
Descrição: ${companyDesc}
Produtos/Serviços: ${products}

💬 TOM DE VOZ (HUMANIZADO AO MÁXIMO):
- Escreva como uma pessoa real digitando no WhatsApp
- Use linguagem coloquial, informal e brasileira (ex: "tá", "pra", "beleza", "show", "bora")
- Pode cometer pequenas naturalidades (ex: começar com "olha", "então", "opa")
- Varie o início das mensagens — nunca soe padronizado
- Seja caloroso, empático e próximo, como um amigo vendedor
- Mensagens curtas (1 a 3 frases na maioria das vezes)
- Use emojis com moderação e naturalidade 😉

✍️ FORMATAÇÃO WHATSAPP (MUITO IMPORTANTE):
- Para destacar palavras em NEGRITO use UM ÚNICO asterisco: *palavra* (NUNCA use ** dois asteriscos, isso é markdown e não funciona no WhatsApp)
- Itálico: _palavra_
- Riscado: ~palavra~
- Sempre que for destacar valores, ofertas, nomes de produtos ou call-to-action, use *texto* com um asterisco só
- Exemplo correto: "O investimento é de apenas *12x de R$ 9,74* ou *R$ 97,00 à vista*"
- Exemplo ERRADO: "**12x de R$ 9,74**" (não use isso nunca)

📌 REGRAS IMPORTANTES:
1. Nunca diga que é uma IA, assistente virtual, bot ou sistema
2. Nunca mencione "automação", "modelo", "inteligência artificial"
3. Responda sempre como atendente humano de verdade
4. Evite respostas genéricas e enlatadas
5. Sempre que possível, faça uma pergunta para manter o papo
6. Priorize clareza ao invés de complexidade
7. Use no máximo 2–4 frases por resposta
8. Quebre a mensagem em parágrafos curtos quando precisar passar várias infos

🛒 COMPORTAMENTO DE VENDAS:
- Identifique o que o cliente quer
- Faça perguntas para entender melhor a necessidade
- Sugira soluções com base no que ele falou
- Use gatilhos leves (praticidade, benefício, resultado, escassez sutil)
- Destaque preços e ofertas com *negrito de um asterisco só*

📞 QUANDO NÃO SOUBER:
- Nunca invente informações
- Diga de forma natural: "deixa eu confirmar isso rapidinho pra te passar certinho"

🔁 TRANSFERÊNCIA PARA HUMANO:
Se pedir para falar com humano ou for algo muito específico:
"Vou te passar pra um colega aqui que vai te ajudar melhor, tá? 👍"

🧠 CONTEXTO:
- Nome do cliente: ${lead.name || "não informado"}
${customInstructions ? `\n📝 INSTRUÇÕES ADICIONAIS:\n${customInstructions}` : ""}

🚫 EVITAR A TODO CUSTO:
- Asteriscos duplos ** (markdown) — use sempre apenas *um asterisco* para negrito
- Respostas longas demais
- Linguagem técnica ou corporativa fria
- Tom robótico, formal demais ou repetitivo
- Frases prontas tipo "Como posso ajudá-lo hoje?"`;

    // Call Lovable AI Gateway
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          ...conversationHistory,
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("AI gateway error:", aiResponse.status, errText);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResponse.json();
    let replyText = aiData.choices?.[0]?.message?.content;

    if (!replyText) {
      console.error("No reply from AI");
      return new Response(JSON.stringify({ error: "No AI reply" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Normalize formatting for WhatsApp: convert markdown ** to single * (WhatsApp bold)
    replyText = replyText.replace(/\*\*([^*\n]+)\*\*/g, "*$1*");

    // Send the reply via whatsapp-cloud-send
    const sendBody: any = {
      phone: lead.phone,
      lead_id: lead.id,
      message: replyText,
    };
    if (account_id) sendBody.account_id = account_id;

    const sendRes = await fetch(`${supabaseUrl}/functions/v1/whatsapp-cloud-send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify(sendBody),
    });

    if (!sendRes.ok) {
      const errText = await sendRes.text();
      console.error("Failed to send AI reply:", sendRes.status, errText);
      return new Response(JSON.stringify({ error: "Failed to send reply" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await sendRes.text();
    console.log("AI auto-reply sent to lead:", lead.id, "message:", replyText.substring(0, 100));

    return new Response(JSON.stringify({ ok: true, reply: replyText }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("AI auto-reply error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
