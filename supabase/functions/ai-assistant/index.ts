// Edge function: ai-assistant
// Full-account AI assistant with tool calling. Admin (admin@primechat.com) can
// operate on any user's data by passing target_user_id; regular users are locked
// to their own user_id regardless of what they send.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ADMIN_EMAIL = "admin@primechat.com";
const AI_MODEL = "google/gemini-3.6-flash";

interface Msg { role: "system" | "user" | "assistant" | "tool"; content: string; tool_calls?: any[]; tool_call_id?: string; name?: string }

const tools = [
  {
    type: "function",
    function: {
      name: "get_business_summary",
      description: "Retorna resumo completo do negócio: leads totais/hoje, aguardando resposta, faturamento 30d, campanhas, taxa de leitura, fluxos ativos, contas WhatsApp.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "list_leads",
      description: "Lista leads da conta. Filtros opcionais por chat_status (aguardando_respostas, respondidas, novos) e busca em nome/telefone.",
      parameters: {
        type: "object",
        properties: {
          chat_status: { type: "string", description: "aguardando_respostas | respondidas | novos" },
          search: { type: "string", description: "Trecho de nome ou telefone" },
          limit: { type: "number", description: "Máximo 50", default: 20 },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_broadcasts",
      description: "Lista disparos recentes com status, contagens e template.",
      parameters: { type: "object", properties: { limit: { type: "number", default: 10 } } },
    },
  },
  {
    type: "function",
    function: {
      name: "list_flows",
      description: "Lista fluxos automatizados (ativos e inativos).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_whatsapp_accounts",
      description: "Lista contas WhatsApp conectadas com número, status, tier e qualidade.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_templates",
      description: "Lista templates aprovados/cadastrados com categoria e idioma.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_monthly_spend",
      description: "Retorna gasto estimado do mês atual (por conta e total) em BRL/USD.",
      parameters: { type: "object", properties: { month_offset: { type: "number", description: "0=mês atual, 1=mês anterior", default: 0 } } },
    },
  },
  {
    type: "function",
    function: {
      name: "pause_broadcast",
      description: "Pausa um disparo em andamento. Use apenas quando o usuário confirmar.",
      parameters: { type: "object", properties: { job_id: { type: "string" } }, required: ["job_id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "resume_broadcast",
      description: "Retoma um disparo pausado.",
      parameters: { type: "object", properties: { job_id: { type: "string" } }, required: ["job_id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "toggle_flow",
      description: "Ativa ou desativa um fluxo automatizado.",
      parameters: {
        type: "object",
        properties: { flow_id: { type: "string" }, active: { type: "boolean" } },
        required: ["flow_id", "active"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_leads_by_ids",
      description: "Exclui leads pelos IDs. Ação irreversível — só use após o usuário confirmar explicitamente.",
      parameters: {
        type: "object",
        properties: { lead_ids: { type: "array", items: { type: "string" } } },
        required: ["lead_ids"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_simple_flow",
      description: "Cria um fluxo automatizado simples com uma mensagem inicial. Use quando o usuário descrever um fluxo curto de boas-vindas ou lembrete. SEMPRE respeite a aba pedida pelo usuário em flow_kind: 'api' = aba 'Fluxos API', 'whatsapp' = aba 'Fluxos WhatsApp'.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          flow_kind: {
            type: "string",
            enum: ["api", "whatsapp"],
            description: "Aba onde o fluxo será criado: 'api' (Fluxos API, padrão) ou 'whatsapp' (Fluxos WhatsApp / Evolution). Use 'whatsapp' apenas se o usuário pedir explicitamente.",
            default: "api",
          },
          trigger_type: { type: "string", description: "manual | cart_abandoned | pix_generated | payment_approved", default: "manual" },
          message: { type: "string", description: "Texto da mensagem inicial (pode usar {nome})" },
          active: { type: "boolean", default: false },
        },
        required: ["name", "message"],
      },
    },
  },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing auth" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return json({ error: "AI indisponível (LOVABLE_API_KEY ausente)" }, 500);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) return json({ error: "Invalid auth" }, 401);

    const authUser = userData.user;
    const isAdmin = authUser.email === ADMIN_EMAIL;

    const body = await req.json().catch(() => ({}));
    const { messages = [], target_user_id } = body as { messages: Msg[]; target_user_id?: string };
    const scopedUserId = isAdmin && target_user_id ? target_user_id : authUser.id;

    const contextLine = isAdmin
      ? `Você tem acesso ADMIN a TODAS as contas do PrimeChat. Escopo atual: ${scopedUserId === authUser.id ? "sua própria conta admin" : `conta do usuário ${scopedUserId}`}.`
      : `Você atende o cliente ${authUser.email}. Acesso restrito à conta dele — nunca cite ou consulte dados de outros usuários.`;

    const systemPrompt = `Você é o Prime Copiloto, assistente sênior de vendas via WhatsApp da plataforma PrimeChat. ${contextLine}

Você tem ferramentas para:
- Consultar métricas, leads, disparos, fluxos, contas e templates.
- Pausar/retomar disparos e ativar/desativar fluxos.
- Criar fluxos simples de boas-vindas (a plataforma tem duas abas: "Fluxos API" (flow_kind="api") e "Fluxos WhatsApp" (flow_kind="whatsapp")).
- Excluir leads (apenas após confirmação).

Regras:
- Fale em PT-BR, tom direto, comercial e prático.
- Use markdown com listas curtas e negrito para números.
- Antes de qualquer ação destrutiva (excluir, pausar, desativar), confirme com o usuário.
- Se faltar dado, chame uma tool ao invés de inventar.
- Quando o usuário pedir "métricas", "como estou", "resumo", chame get_business_summary primeiro.
- Ao criar fluxo, sempre defina flow_kind conforme a aba citada pelo usuário: "Fluxo API"/"API" → "api"; "Fluxo WhatsApp"/"Evolution"/"QR Code" → "whatsapp". Se não ficar claro, use "api" e informe em qual aba o fluxo foi criado.
- Não mencione que você é uma IA — apresente-se como copiloto da equipe.`;

    const convo: Msg[] = [{ role: "system", content: systemPrompt }, ...messages];

    // Tool loop (max 6 rounds)
    for (let round = 0; round < 6; round++) {
      const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: AI_MODEL, messages: convo, tools, tool_choice: "auto" }),
      });

      if (!aiResp.ok) {
        if (aiResp.status === 429) return json({ error: "Muitas requisições. Aguarde alguns segundos." }, 429);
        if (aiResp.status === 402) return json({ error: "Créditos de IA esgotados. Adicione créditos no workspace." }, 402);
        const t = await aiResp.text();
        console.error("AI error:", aiResp.status, t);
        return json({ error: "Falha na IA" }, 500);
      }

      const aiData = await aiResp.json();
      const msg = aiData.choices?.[0]?.message;
      if (!msg) return json({ error: "Resposta vazia da IA" }, 500);

      const toolCalls = msg.tool_calls;
      if (!toolCalls || toolCalls.length === 0) {
        return json({ reply: msg.content || "" });
      }

      convo.push({ role: "assistant", content: msg.content || "", tool_calls: toolCalls } as any);

      for (const call of toolCalls) {
        const fname = call.function?.name;
        let args: any = {};
        try { args = JSON.parse(call.function?.arguments || "{}"); } catch (_e) {}
        const result = await runTool(fname, args, admin, scopedUserId);
        convo.push({
          role: "tool",
          tool_call_id: call.id,
          name: fname,
          content: JSON.stringify(result).slice(0, 12000),
        });
      }
    }

    return json({ reply: "Não consegui concluir — muitos passos. Reformule a pergunta, por favor." });
  } catch (err: any) {
    console.error("ai-assistant error:", err);
    return json({ error: err?.message || "Erro" }, 500);
  }
});

async function runTool(name: string, args: any, admin: SupabaseClient, userId: string): Promise<any> {
  try {
    switch (name) {
      case "get_business_summary": {
        const now = Date.now();
        const dayMs = 24 * 3600 * 1000;
        const [leadsRes, ordersRes, jobsRes, flowsRes, accountsRes] = await Promise.all([
          admin.from("leads").select("id, last_inbound_at, last_outbound_at, chat_status, created_at").eq("user_id", userId).limit(2000),
          admin.from("orders").select("amount, status, created_at").eq("status", "approved").gte("created_at", new Date(now - 30 * dayMs).toISOString()),
          admin.from("broadcast_jobs").select("id, status, sent_count, delivered_count, read_count, error_count").eq("user_id", userId).order("created_at", { ascending: false }).limit(30),
          admin.from("flows").select("id, active").eq("user_id", userId),
          admin.from("whatsapp_accounts").select("id, name, phone_number_id, last_health_status").eq("user_id", userId),
        ]);
        const leads = leadsRes.data || [];
        const jobs = jobsRes.data || [];
        const totalSent = jobs.reduce((s, j: any) => s + (j.sent_count || 0), 0);
        const totalRead = jobs.reduce((s, j: any) => s + (j.read_count || 0), 0);
        return {
          total_leads: leads.length,
          leads_today: leads.filter((l: any) => now - new Date(l.created_at).getTime() < dayMs).length,
          pending_responses: leads.filter((l: any) => l.last_inbound_at && (!l.last_outbound_at || new Date(l.last_inbound_at) > new Date(l.last_outbound_at))).length,
          revenue_30d: (ordersRes.data || []).reduce((s, o: any) => s + Number(o.amount || 0), 0),
          total_campaigns: jobs.length,
          total_sent: totalSent,
          read_rate_percent: totalSent > 0 ? Math.round((totalRead / totalSent) * 100) : 0,
          active_flows: (flowsRes.data || []).filter((f: any) => f.active).length,
          total_flows: (flowsRes.data || []).length,
          accounts: (accountsRes.data || []).map((a: any) => ({ id: a.id, name: a.name, phone_number_id: a.phone_number_id, status: a.last_health_status })),
        };
      }
      case "list_leads": {
        const limit = Math.min(50, args.limit || 20);
        let q = admin.from("leads").select("id, name, phone, email, chat_status, last_inbound_at, last_outbound_at, created_at").eq("user_id", userId).order("updated_at", { ascending: false }).limit(limit);
        if (args.chat_status) q = q.eq("chat_status", args.chat_status);
        if (args.search) q = q.or(`name.ilike.%${args.search}%,phone.ilike.%${args.search}%`);
        const { data, error } = await q;
        if (error) return { error: error.message };
        return { leads: data || [], count: (data || []).length };
      }
      case "list_broadcasts": {
        const limit = Math.min(30, args.limit || 10);
        const { data, error } = await admin.from("broadcast_jobs").select("id, template_name, status, sent_count, delivered_count, read_count, error_count, total_leads, created_at, last_error").eq("user_id", userId).order("created_at", { ascending: false }).limit(limit);
        if (error) return { error: error.message };
        return { broadcasts: data || [] };
      }
      case "list_flows": {
        const { data, error } = await admin.from("flows").select("id, name, description, active, trigger_type, flow_kind, created_at").eq("user_id", userId).order("created_at", { ascending: false });
        if (error) return { error: error.message };
        return { flows: data || [] };
      }
      case "list_whatsapp_accounts": {
        const { data, error } = await admin.from("whatsapp_accounts").select("id, name, phone_number_id, last_health_status, is_default").eq("user_id", userId);
        if (error) return { error: error.message };
        return { accounts: data || [] };
      }
      case "list_templates": {
        const { data, error } = await admin.from("chat_templates").select("id, name, category, language, status").eq("user_id", userId).limit(200);
        if (error) return { error: error.message };
        return { templates: data || [] };
      }
      case "get_monthly_spend": {
        const monthOffset = Math.max(0, args.month_offset || 0);
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1);
        const end = new Date(now.getFullYear(), now.getMonth() - monthOffset + 1, 1);
        const [jobsRes, tplRes, accRes] = await Promise.all([
          admin.from("broadcast_jobs").select("id, account_id, template_id, sent_count").eq("user_id", userId).gte("created_at", start.toISOString()).lt("created_at", end.toISOString()),
          admin.from("chat_templates").select("id, category").eq("user_id", userId),
          admin.from("whatsapp_accounts").select("id, name, phone_number_id").eq("user_id", userId),
        ]);
        const PRICING: any = { utility: 0.008, marketing: 0.0625, authentication: 0.0315, service: 0 };
        const inferCat = (c: any) => { const s = (c || "").toLowerCase(); if (s.includes("util")) return "utility"; if (s.includes("auth")) return "authentication"; if (s.includes("service")) return "service"; return "marketing"; };
        const tplCat = new Map((tplRes.data || []).map((t: any) => [t.id, inferCat(t.category)]));
        const accMap = new Map((accRes.data || []).map((a: any) => [a.id, a.name || a.phone_number_id]));
        let totalUsd = 0;
        const byAcc: Record<string, { name: string; sent: number; usd: number }> = {};
        for (const j of jobsRes.data || []) {
          const cat = (j.template_id && tplCat.get(j.template_id)) || "marketing";
          const cost = (j.sent_count || 0) * (PRICING[cat] ?? PRICING.marketing);
          totalUsd += cost;
          const key = j.account_id || "sem_conta";
          byAcc[key] = byAcc[key] || { name: accMap.get(j.account_id) || "Sem conta", sent: 0, usd: 0 };
          byAcc[key].sent += j.sent_count || 0;
          byAcc[key].usd += cost;
        }
        return {
          month: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`,
          total_usd: +totalUsd.toFixed(2),
          total_brl: +(totalUsd * 5.2).toFixed(2),
          by_account: Object.values(byAcc).map((r) => ({ ...r, usd: +r.usd.toFixed(2), brl: +(r.usd * 5.2).toFixed(2) })),
        };
      }
      case "pause_broadcast": {
        const { error } = await admin.from("broadcast_jobs").update({ status: "paused", pause_reason: "Pausado pelo copiloto" }).eq("id", args.job_id).eq("user_id", userId);
        if (error) return { error: error.message };
        return { ok: true };
      }
      case "resume_broadcast": {
        const { error } = await admin.from("broadcast_jobs").update({ status: "processing", pause_reason: null }).eq("id", args.job_id).eq("user_id", userId);
        if (error) return { error: error.message };
        return { ok: true };
      }
      case "toggle_flow": {
        const { error } = await admin.from("flows").update({ active: !!args.active }).eq("id", args.flow_id).eq("user_id", userId);
        if (error) return { error: error.message };
        return { ok: true };
      }
      case "delete_leads_by_ids": {
        const ids = (args.lead_ids || []).slice(0, 500);
        if (ids.length === 0) return { error: "Nenhum ID informado" };
        const { error, count } = await admin.from("leads").delete({ count: "exact" }).in("id", ids).eq("user_id", userId);
        if (error) return { error: error.message };
        return { deleted: count || ids.length };
      }
      case "create_simple_flow": {
        const { data: flow, error } = await admin.from("flows").insert({
          user_id: userId,
          name: args.name,
          description: args.description || null,
          active: !!args.active,
          trigger_type: args.trigger_type || "manual",
          // Respeita a aba pedida pelo usuário; "api" é o padrão do app.
          flow_kind: args.flow_kind === "whatsapp" ? "whatsapp" : "api",
        }).select("id").single();
        if (error) return { error: error.message };
        // Entry step
        await admin.from("flow_steps").insert({
          flow_id: flow.id,
          step_order: 1,
          step_type: "message",
          custom_message: args.message,
          is_entry: true,
        });
        return { ok: true, flow_id: flow.id, flow_kind: args.flow_kind === "whatsapp" ? "whatsapp" : "api" };
      }
      default:
        return { error: `Ferramenta desconhecida: ${name}` };
    }
  } catch (e: any) {
    return { error: e?.message || "Erro na ferramenta" };
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
