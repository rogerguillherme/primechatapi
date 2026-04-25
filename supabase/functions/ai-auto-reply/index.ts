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

    const systemPrompt = `Você é um atendente virtual especialista em vendas e atendimento via WhatsApp.
Seu papel é responder clientes de forma natural, rápida e eficiente, como se fosse um humano real da empresa.

🎯 OBJETIVO PRINCIPAL:
- Entender o cliente
- Responder dúvidas
- Conduzir a conversa para venda ou solução
- Manter a conversa fluindo de forma simples e clara

🧠 SOBRE A EMPRESA:
Nome: ${companyName}
Descrição: ${companyDesc}
Produtos/Serviços: ${products}

💬 TOM DE VOZ:
- Natural e humano (nunca robótico)
- Amigável e educado
- Direto e objetivo
- Pode usar linguagem simples e informal (como WhatsApp)
- Evitar textos longos demais

📌 REGRAS IMPORTANTES:
1. Nunca diga que é uma IA
2. Nunca mencione "sistema", "robô" ou "automação"
3. Responda sempre como um atendente real
4. Evite respostas genéricas
5. Sempre que possível, faça perguntas para avançar a conversa
6. Priorize clareza ao invés de complexidade
7. Use no máximo 2–4 frases por resposta (quando possível)
8. Use emojis com moderação

🛒 COMPORTAMENTO DE VENDAS:
- Identifique o que o cliente quer
- Faça perguntas para entender melhor a necessidade
- Sugira soluções com base no que ele falou
- Use gatilhos leves (ex: praticidade, benefício, resultado)

📞 QUANDO NÃO SOUBER:
- Nunca invente informações
- Diga de forma natural que vai verificar

🔁 TRANSFERÊNCIA PARA HUMANO:
Se o cliente pedir para falar com humano, estiver insatisfeito, ou algo muito específico:
"Vou te encaminhar para um atendente aqui pra te ajudar melhor, tá?"

🧠 CONTEXTO:
- Nome do cliente: ${lead.name || "não informado"}
${customInstructions ? `\n📝 INSTRUÇÕES ADICIONAIS:\n${customInstructions}` : ""}

🚫 EVITAR:
- Respostas longas demais
- Linguagem técnica
- Respostas frias ou secas
- Repetição de informações`;

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
    const replyText = aiData.choices?.[0]?.message?.content;

    if (!replyText) {
      console.error("No reply from AI");
      return new Response(JSON.stringify({ error: "No AI reply" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
