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

    let accountOwnerId: string | null = null;
    if (account_id) {
      const { data: account } = await supabase
        .from("whatsapp_accounts")
        .select("id, user_id")
        .eq("id", account_id)
        .maybeSingle();

      if (!account?.user_id) {
        return new Response(JSON.stringify({ skipped: "account_not_found" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      accountOwnerId = account.user_id;
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

    // Get AI config from app_settings (fallback)
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

    // Get lead info (including bound agent)
    const { data: lead } = await supabase
      .from("leads")
      .select("id, name, phone, user_id, ai_agent_id")
      .eq("id", lead_id)
      .single();

    if (!lead) {
      return new Response(JSON.stringify({ error: "Lead not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (accountOwnerId && lead.user_id !== accountOwnerId) {
      console.warn("AI auto-reply skipped: account/lead owner mismatch", JSON.stringify({ lead_id, account_id }));
      return new Response(JSON.stringify({ skipped: "account_lead_mismatch" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Try to load the agent bound to this lead (configured per event), strictly scoped to the lead owner
    let agent: any = null;
    if (lead.ai_agent_id) {
      const { data: a } = await supabase
        .from("ai_agents")
        .select("name, identity, instructions, knowledge, faq, guidelines, ai_model, active, user_id")
        .eq("id", lead.ai_agent_id)
        .eq("user_id", lead.user_id)
        .maybeSingle();
      if (a?.active !== false) agent = a;
    }

    if (!agent && lead.user_id) {
      const { data: defaultAgent } = await supabase
        .from("ai_agents")
        .select("name, identity, instructions, knowledge, faq, guidelines, ai_model, active, user_id")
        .eq("user_id", lead.user_id)
        .eq("active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (defaultAgent) agent = defaultAgent;
    }

    const forbiddenContextTerms = [
      "fábrica de dólar",
      "fabrica de dolar",
      "lucrar em dólar",
      "lucrar em dolar",
      "faturar em dólar",
      "faturar em dolar",
      "ganhar em dólar",
      "ganhar em dolar",
      "moeda forte",
      "kiwify.com.br/j0hsxv3",
    ];

    const agentText = [agent?.name, agent?.identity, agent?.instructions, agent?.knowledge, agent?.guidelines]
      .filter(Boolean)
      .join("\n")
      .toLowerCase();

    const shouldIgnoreHistoryMessage = (content: string) => {
      const lower = (content || "").toLowerCase();
      return forbiddenContextTerms.some((term) => lower.includes(term) && !agentText.includes(term));
    };

    // Get recent conversation history (last 20 messages)
    const { data: history } = await supabase
      .from("chat_messages")
      .select("direction, content, created_at")
      .eq("lead_id", lead_id)
      .order("created_at", { ascending: false })
      .limit(20);

    const conversationHistory = (history || [])
      .reverse()
      .filter((m) => !shouldIgnoreHistoryMessage(m.content || ""))
      .map((m) => ({
        role: m.direction === "inbound" ? "user" as const : "assistant" as const,
        content: m.content,
      }));

    // Build system prompt — prefer per-lead agent if available
    let systemPrompt: string;
    let modelToUse = "google/gemini-3-flash-preview";

    if (agent) {
      modelToUse = agent.ai_model || modelToUse;
      const faqText = Array.isArray(agent.faq) && agent.faq.length
        ? agent.faq.map((f: any) => `- P: ${f.question || f.q || ""}\n  R: ${f.answer || f.a || ""}`).join("\n")
        : "";
      systemPrompt = `Você é um atendente humano de verdade respondendo clientes pelo WhatsApp. Jamais demonstre ser uma IA, robô ou automação.

🧠 IDENTIDADE / PERSONA:
${agent.identity || agent.name || "Atendente da empresa"}

📋 INSTRUÇÕES:
${agent.instructions || ""}

📚 CONHECIMENTO / BASE:
${agent.knowledge || ""}

🎯 DIRETRIZES:
${agent.guidelines || ""}

${faqText ? `❓ FAQ:\n${faqText}\n` : ""}

✍️ FORMATAÇÃO WHATSAPP:
- Negrito: *texto* (UM asterisco apenas — nunca **)
- Itálico: _texto_
- Mensagens curtas (1-3 frases), tom humano e brasileiro
- Use emojis com moderação 😉

🧠 CONTEXTO:
- Nome do cliente: ${lead.name || "não informado"}

🚫 NUNCA:
- Diga que é IA / bot / sistema
- Use ** (asterisco duplo)
- Invente informações
- Misture produtos, marcas, links, promessas ou histórico de outros agentes/empresas; responda somente com base na identidade e conhecimento deste agente`;
    } else {
      const companyName = config.ai_company_name || "Nossa Empresa";
      const companyDesc = config.ai_company_description || "";
      const products = config.ai_products_services || "";
      const customInstructions = config.ai_custom_instructions || "";

      systemPrompt = `Você é um atendente humano de verdade da empresa, respondendo clientes pelo WhatsApp.
Sua missão é parecer 100% humano — jamais demonstre ser uma IA, robô ou automação.

🧠 SOBRE A EMPRESA:
Nome: ${companyName}
Descrição: ${companyDesc}
Produtos/Serviços: ${products}

✍️ FORMATAÇÃO WHATSAPP:
- Negrito: *texto* (UM asterisco apenas)
- Mensagens curtas (1-3 frases), tom humano e brasileiro
- Use emojis com moderação

🧠 CONTEXTO:
- Nome do cliente: ${lead.name || "não informado"}
${customInstructions ? `\n📝 INSTRUÇÕES ADICIONAIS:\n${customInstructions}` : ""}

🚫 NUNCA: dizer que é IA, usar **, inventar informações.`;
    }

    // Call Lovable AI Gateway
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelToUse,
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
