import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { description } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const systemPrompt = `You are a WhatsApp automation flow builder AI. Given a user description, generate a JSON array of flow steps.

Each step must have:
- "type": one of "message", "delay", "condition", "interactive_buttons", "cta_url"
- "data": object with properties depending on type:
  - message: { "custom_message": "text content" }
  - delay: { "delay_minutes": number }
  - condition: { "trigger_value": "condition text" }
  - interactive_buttons: { "custom_message": "text", "buttons": [{ "id": "uuid", "title": "button text" }] } (max 3 buttons)
  - cta_url: { "custom_message": "text", "buttons": [{ "id": "uuid", "title": "button text", "url": "https://..." }] }

Rules:
- Generate between 2-10 steps
- Make messages natural and in Portuguese (Brazil)
- Use realistic delay times (e.g., 5 min, 60 min, 1440 min for 1 day)
- Generate unique UUIDs for button IDs using random hex strings
- Return ONLY a valid JSON array, no markdown, no explanation

Example output:
[
  { "type": "message", "data": { "custom_message": "Olá! Bem-vindo ao nosso atendimento. Como posso ajudar?" } },
  { "type": "delay", "data": { "delay_minutes": 5 } },
  { "type": "interactive_buttons", "data": { "custom_message": "Você gostaria de saber mais sobre nossos produtos?", "buttons": [{ "id": "a1b2c3", "title": "Sim" }, { "id": "d4e5f6", "title": "Não" }] } }
]`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: description },
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Limite de requisições excedido. Tente novamente em alguns segundos." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos de IA esgotados." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      throw new Error("AI gateway error");
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || "[]";

    // Extract JSON from response (handle potential markdown wrapping)
    let jsonStr = content.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    const steps = JSON.parse(jsonStr);

    return new Response(JSON.stringify({ steps }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("generate-flow error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
