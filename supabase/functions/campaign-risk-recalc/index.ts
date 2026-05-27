// Anti-Ban v2 — Fase 1.1: Campaign Risk Recalc
// Cron a cada 5min. Recalcula campaign_risk_profiles a partir de message_logs +
// unsubscribe_logs e atribui risk_level.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface BroadcastJob {
  id: string;
  user_id: string;
  template_id: string | null;
  sent_count: number;
  delivered_count: number;
  read_count: number;
  error_count: number;
  status: string;
  created_at: string;
}

function computeRiskLevel(
  blockRate: number,
  unsubRate: number,
  replyRate: number,
  sentCount: number,
): "low" | "medium" | "high" | "critical" {
  if (blockRate > 3) return "critical";
  if (unsubRate > 5) return "high";
  if (sentCount > 1000 && replyRate < 1) return "medium";
  if (unsubRate > 2 || blockRate > 1) return "medium";
  return "low";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    // Process jobs from last 30 days, all statuses except pending/draft
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const { data: jobs, error: jobsErr } = await supabase
      .from("broadcast_jobs")
      .select("id,user_id,template_id,sent_count,delivered_count,read_count,error_count,status,created_at")
      .gte("created_at", since)
      .neq("status", "pending")
      .neq("status", "draft");

    if (jobsErr) throw jobsErr;

    const results: Array<Record<string, unknown>> = [];

    for (const job of (jobs ?? []) as BroadcastJob[]) {
      // Aggregate from message_logs (more precise)
      const { data: agg } = await supabase
        .from("message_logs")
        .select("status,block_severity")
        .eq("job_id", job.id);

      const rows = agg ?? [];
      const sent = rows.length || job.sent_count || 0;
      const delivered = rows.filter((r) => r.status === "delivered" || r.status === "read").length;
      const read = rows.filter((r) => r.status === "read").length;
      const blocked = rows.filter((r) => r.block_severity === "high" || r.block_severity === "critical").length;

      // Replies from chat_messages tied to leads in this user
      // (cheap approximation: count inbound after job created_at for now)
      const { count: replyCount } = await supabase
        .from("chat_messages")
        .select("id", { count: "exact", head: true })
        .eq("direction", "inbound")
        .gte("created_at", job.created_at);

      // Unsubscribes from this user since job started
      const { count: unsubCount } = await supabase
        .from("unsubscribe_logs")
        .select("id", { count: "exact", head: true })
        .eq("user_id", job.user_id)
        .gte("created_at", job.created_at);

      const safe = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);
      const delivery_rate = safe(delivered, sent);
      const read_rate = safe(read, sent);
      const reply_rate = safe(replyCount ?? 0, sent);
      const block_rate = safe(blocked, sent);
      const unsubscribe_rate = safe(unsubCount ?? 0, sent);

      const risk_level = computeRiskLevel(block_rate, unsubscribe_rate, reply_rate, sent);
      const quality_impact_score = Math.round(
        block_rate * 10 + unsubscribe_rate * 5 - delivery_rate * 0.3,
      );

      const payload = {
        user_id: job.user_id,
        campaign_id: job.id,
        template_ids: job.template_id ? [job.template_id] : [],
        sent_count: sent,
        delivered_count: delivered,
        read_count: read,
        reply_count: replyCount ?? 0,
        unsubscribe_count: unsubCount ?? 0,
        block_count: blocked,
        delivery_rate,
        read_rate,
        reply_rate,
        unsubscribe_rate,
        block_rate,
        spam_signal_count: 0,
        quality_impact_score,
        risk_level,
        last_calculated_at: new Date().toISOString(),
      };

      await supabase
        .from("campaign_risk_profiles")
        .upsert(payload, { onConflict: "campaign_id" });

      results.push({ campaign_id: job.id, risk_level, sent });
    }

    return new Response(
      JSON.stringify({ ok: true, processed: results.length, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[campaign-risk-recalc] error", e);
    return new Response(
      JSON.stringify({ ok: false, error: String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
