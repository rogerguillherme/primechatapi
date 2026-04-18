// Edge function: dashboard-insights
// Generates 3 actionable AI insights based on the user's business metrics.
// Uses Lovable AI Gateway (Gemini Flash) — no streaming.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface Insight {
  id: string;
  icon: string;
  title: string;
  description: string;
  severity: "info" | "opportunity" | "warning";
}

const fallbackInsights: Insight[] = [
  {
    id: "fallback-1",
    icon: "🎯",
    title: "Comece coletando seus primeiros leads",
    description:
      "Conecte o WhatsApp e importe contatos para começar a ver insights personalizados aqui.",
    severity: "info",
  },
  {
    id: "fallback-2",
    icon: "🚀",
    title: "Crie sua primeira campanha",
    description:
      "Templates prontos de recuperação de carrinho podem aumentar suas vendas em até 30%.",
    severity: "opportunity",
  },
  {
    id: "fallback-3",
    icon: "⚡",
    title: "Ative um fluxo de boas-vindas",
    description:
      "Automatize a primeira resposta e nunca perca um lead novo por demora.",
    severity: "info",
  },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing auth" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await adminClient.auth.getUser(token);
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Invalid auth" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = userData.user.id;

    // Gather lightweight stats (RLS via service role + filter)
    const [leadsRes, ordersRes, campaignsRes, flowsRes] = await Promise.all([
      adminClient.from("leads").select("id, last_inbound_at, last_outbound_at, chat_status, created_at").eq("user_id", userId).limit(500),
      adminClient.from("orders").select("amount, status, created_at").eq("status", "approved").order("created_at", { ascending: false }).limit(200),
      adminClient.from("broadcast_jobs").select("id, status, sent_count, delivered_count, read_count, error_count, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(20),
      adminClient.from("flows").select("id, active").eq("user_id", userId),
    ]);

    const leads = leadsRes.data || [];
    const orders = ordersRes.data || [];
    const campaigns = campaignsRes.data || [];
    const flows = flowsRes.data || [];

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    const leadsToday = leads.filter((l) => now - new Date(l.created_at).getTime() < dayMs).length;
    const pendingResponses = leads.filter(
      (l) => l.last_inbound_at && (!l.last_outbound_at || new Date(l.last_inbound_at) > new Date(l.last_outbound_at))
    ).length;
    const revenueLast30d = orders
      .filter((o) => now - new Date(o.created_at).getTime() < 30 * dayMs)
      .reduce((s: number, o: any) => s + Number(o.amount || 0), 0);
    const totalSent = campaigns.reduce((s: number, c: any) => s + (c.sent_count || 0), 0);
    const totalRead = campaigns.reduce((s: number, c: any) => s + (c.read_count || 0), 0);
    const readRate = totalSent > 0 ? Math.round((totalRead / totalSent) * 100) : 0;
    const activeFlows = flows.filter((f: any) => f.active).length;

    const stats = {
      total_leads: leads.length,
      leads_today: leadsToday,
      pending_responses: pendingResponses,
      revenue_30d: Math.round(revenueLast30d),
      total_campaigns: campaigns.length,
      read_rate_percent: readRate,
      active_flows: activeFlows,
    };

    // If no AI key, return rule-based insights
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ insights: ruleBasedInsights(stats), stats }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const systemPrompt =
      "Você é um analista de vendas no WhatsApp para PMEs brasileiras. Gere EXATAMENTE 3 insights curtos, acionáveis e específicos baseados nas métricas. Tom: direto, comercial, amigável (PT-BR). Evite jargão técnico. Use dados concretos quando possível.";

    const userPrompt = `Métricas do negócio:
- Leads totais: ${stats.total_leads}
- Leads novos hoje: ${stats.leads_today}
- Leads aguardando resposta: ${stats.pending_responses}
- Faturamento últimos 30 dias: R$ ${stats.revenue_30d}
- Campanhas enviadas: ${stats.total_campaigns}
- Taxa de leitura média: ${stats.read_rate_percent}%
- Fluxos ativos: ${stats.active_flows}

Gere 3 insights priorizando oportunidades de vendas e ações urgentes.`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "emit_insights",
              description: "Retorna 3 insights estruturados.",
              parameters: {
                type: "object",
                properties: {
                  insights: {
                    type: "array",
                    minItems: 3,
                    maxItems: 3,
                    items: {
                      type: "object",
                      properties: {
                        icon: { type: "string", description: "Emoji único representando o insight" },
                        title: { type: "string", description: "Título curto, máx 70 caracteres" },
                        description: { type: "string", description: "Frase única explicando + ação sugerida, máx 140 caracteres" },
                        severity: { type: "string", enum: ["info", "opportunity", "warning"] },
                      },
                      required: ["icon", "title", "description", "severity"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["insights"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "emit_insights" } },
      }),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) {
        return new Response(
          JSON.stringify({ insights: ruleBasedInsights(stats), stats, fallback: "rate_limited" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (aiResp.status === 402) {
        return new Response(
          JSON.stringify({ insights: ruleBasedInsights(stats), stats, fallback: "credits_exhausted" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const t = await aiResp.text();
      console.error("AI gateway error:", aiResp.status, t);
      return new Response(
        JSON.stringify({ insights: ruleBasedInsights(stats), stats, fallback: "ai_error" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiData = await aiResp.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    let insights: Insight[] = [];
    if (toolCall?.function?.arguments) {
      try {
        const parsed = JSON.parse(toolCall.function.arguments);
        insights = (parsed.insights || []).slice(0, 3).map((i: any, idx: number) => ({
          id: `ai-${Date.now()}-${idx}`,
          icon: i.icon || "✨",
          title: String(i.title || "").slice(0, 80),
          description: String(i.description || "").slice(0, 160),
          severity: ["info", "opportunity", "warning"].includes(i.severity) ? i.severity : "info",
        }));
      } catch (e) {
        console.error("Failed to parse insights:", e);
      }
    }

    if (insights.length === 0) insights = ruleBasedInsights(stats);

    return new Response(JSON.stringify({ insights, stats }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("dashboard-insights error:", err);
    return new Response(
      JSON.stringify({ insights: fallbackInsights, error: err?.message || "Unknown error" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function ruleBasedInsights(stats: any): Insight[] {
  const out: Insight[] = [];

  if (stats.pending_responses > 0) {
    out.push({
      id: "rule-pending",
      icon: "⚡",
      title: `${stats.pending_responses} leads aguardando sua resposta`,
      description: "Responder em até 5 minutos aumenta a conversão em até 9x. Abra o chat agora.",
      severity: "warning",
    });
  }

  if (stats.leads_today >= 1) {
    out.push({
      id: "rule-today",
      icon: "🎯",
      title: `${stats.leads_today} novo${stats.leads_today > 1 ? "s" : ""} contato${stats.leads_today > 1 ? "s" : ""} hoje`,
      description: "Aproveite o momento e envie uma mensagem de boas-vindas personalizada.",
      severity: "opportunity",
    });
  }

  if (stats.active_flows === 0) {
    out.push({
      id: "rule-flows",
      icon: "🤖",
      title: "Você não tem nenhum fluxo automatizado ativo",
      description: "Ative um fluxo de boas-vindas para responder leads 24h sem ninguém na escala.",
      severity: "opportunity",
    });
  }

  if (stats.total_campaigns === 0) {
    out.push({
      id: "rule-campaign",
      icon: "🚀",
      title: "Comece sua primeira campanha de WhatsApp",
      description: "Templates prontos de recuperação de carrinho podem trazer 30% mais vendas.",
      severity: "opportunity",
    });
  }

  if (stats.read_rate_percent > 0 && stats.read_rate_percent < 40 && out.length < 3) {
    out.push({
      id: "rule-readrate",
      icon: "📉",
      title: `Taxa de leitura está em ${stats.read_rate_percent}%`,
      description: "Teste enviar suas campanhas em horários comerciais (10h-12h e 18h-20h).",
      severity: "warning",
    });
  }

  while (out.length < 3) out.push(fallbackInsights[out.length]);
  return out.slice(0, 3);
}
