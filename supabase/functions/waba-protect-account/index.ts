// Centraliza a proteção automática de uma conta WhatsApp quando a Meta
// retorna erros críticos (bloqueio, restrição de qualidade, spam, etc).
// Pausa broadcasts, fluxos e execuções em andamento e cria notificação.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PayloadIn {
  account_id: string;
  user_id?: string | null;
  reason: string; // "waba_locked" | "quality_red" | "spam_restriction" | ...
  meta_error_code?: string | null;
  meta_error_title?: string | null;
  meta_error_details?: string | null;
  severity?: "critical" | "warning" | "info";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json()) as PayloadIn;
    if (!body?.account_id || !body?.reason) {
      return new Response(JSON.stringify({ error: "account_id and reason required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let userId = body.user_id || null;
    if (!userId) {
      const { data: acc } = await supabase
        .from("whatsapp_accounts")
        .select("user_id")
        .eq("id", body.account_id)
        .maybeSingle();
      userId = acc?.user_id || null;
    }
    if (!userId) {
      return new Response(JSON.stringify({ error: "account not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const severity = body.severity || "critical";

    // 1) Avoid duplicate events within 5 minutes for same code/account
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: existing } = await supabase
      .from("waba_health_events")
      .select("id")
      .eq("account_id", body.account_id)
      .eq("event_code", body.reason)
      .is("resolved_at", null)
      .gte("created_at", fiveMinAgo)
      .maybeSingle();

    if (!existing) {
      await supabase.from("waba_health_events").insert({
        user_id: userId,
        account_id: body.account_id,
        event_code: body.reason,
        event_title: body.meta_error_title || titleFor(body.reason),
        event_message: body.meta_error_details || messageFor(body.reason),
        severity,
        meta_error_code: body.meta_error_code || null,
        metadata: {},
      });
    }

    // 2) For critical events, pause broadcasts/flows/executions for this account
    if (severity === "critical") {
      // Pause active broadcast_jobs targeting this account
      const { data: pausedJobs } = await supabase
        .from("broadcast_jobs")
        .update({
          status: "paused",
          pause_reason: `auto:${body.reason}`,
          auto_paused_by_system: true,
          last_error: body.meta_error_title || body.reason,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .in("status", ["pending", "running", "processing"])
        .or(`account_id.eq.${body.account_id},account_ids.cs.{${body.account_id}}`)
        .select("id");

      // Pause flows that have any execution tied to this account
      const { data: execs } = await supabase
        .from("flow_executions")
        .select("flow_id")
        .eq("metadata->>account_id", body.account_id)
        .in("status", ["waiting_delay", "waiting_no_response", "waiting_reply", "running"]);

      const flowIds = Array.from(new Set((execs || []).map((e: any) => e.flow_id)));
      if (flowIds.length > 0) {
        await supabase
          .from("flows")
          .update({ active: false, auto_paused_by_system: true, updated_at: new Date().toISOString() })
          .in("id", flowIds)
          .eq("active", true);

        // Cancel pending executions
        await supabase
          .from("flow_executions")
          .update({
            status: "cancelled",
            next_action_at: null,
            updated_at: new Date().toISOString(),
          })
          .in("flow_id", flowIds)
          .in("status", ["waiting_delay", "waiting_no_response"]);
      }

      // 3) Notify the user
      await supabase.from("notifications").insert({
        user_id: userId,
        type: "error",
        title: titleFor(body.reason),
        message: messageFor(body.reason),
        link: "/whatsapp/health",
      });

      // 4) Audit
      await supabase.from("audit_logs").insert({
        user_id: userId,
        action: "auto_pause_waba",
        table_name: "whatsapp_accounts",
        record_id: body.account_id,
        details: {
          reason: body.reason,
          meta_error_code: body.meta_error_code,
          paused_jobs: pausedJobs?.length || 0,
          paused_flows: flowIds.length,
        },
      });
    }

    return new Response(
      JSON.stringify({ ok: true, deduped: !!existing }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("waba-protect-account error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function titleFor(code: string): string {
  switch (code) {
    case "waba_locked": return "Conta WhatsApp temporariamente bloqueada pela Meta";
    case "payment_issue": return "Problema de pagamento/elegibilidade na sua Business Manager";
    case "quality_red": return "Qualidade da sua conta caiu para VERMELHO";
    case "quality_yellow": return "Qualidade da sua conta caiu para AMARELO";
    case "spam_restriction": return "Restrição de spam aplicada pela Meta";
    case "rate_limit": return "Limite de envio atingido";
    case "integrity_restriction": return "Restrição de integridade aplicada pela Meta";
    default: return "Atenção: problema detectado na sua conta WhatsApp";
  }
}

function messageFor(code: string): string {
  switch (code) {
    case "payment_issue":
      return "A Meta recusou os envios com o erro 131042 (Business eligibility payment issue). Pausamos os disparos automaticamente. Regularize o método de pagamento da Business Manager no Meta Business Suite → Cobrança e tente novamente.";
    case "waba_locked":
      return "Não é um problema da plataforma — a Meta restringiu sua WABA. Pausamos seus disparos automaticamente para proteger sua reputação. Acesse o Meta Business Suite → Account Quality → Solicitar revisão.";
    case "quality_red":
      return "Reduzimos o ritmo dos seus disparos para proteger sua conta. Evite envios em massa até que a qualidade volte ao normal.";
    case "spam_restriction":
      return "Sua conta recebeu sinalizações de spam. Reduza o volume e melhore o conteúdo das mensagens.";
    case "rate_limit":
      return "Você atingiu o limite atual de envios. Aguarde alguns minutos antes de continuar.";
    case "integrity_restriction":
      return "A Meta sinalizou problemas de integridade no conteúdo ou template enviado.";
    default:
      return "Detectamos um problema na sua conta. Verifique o painel de saúde.";
  }
}
