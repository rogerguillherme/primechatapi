// Edge function: spend-metrics
// Returns estimated WhatsApp Cloud API spend for the current month, broken
// down by account (and totals). Estimates come from message_logs + broadcast_jobs
// combined with Meta's public BR pricing. Meta Graph billing API is queried
// when a system-user token is available; otherwise the response is estimate-only.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// WhatsApp Cloud API pricing (USD per conversation, BR — approximate 2026)
const PRICING = {
  utility: 0.008,
  marketing: 0.0625,
  authentication: 0.0315,
  service: 0,
};
const USD_TO_BRL = 5.2;

function inferCategory(cat: string | null | undefined): "utility" | "marketing" | "authentication" | "service" {
  const c = (cat || "").toLowerCase();
  if (c.includes("util")) return "utility";
  if (c.includes("auth")) return "authentication";
  if (c.includes("service")) return "service";
  return "marketing";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing auth" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) return json({ error: "Invalid auth" }, 401);
    const userId = userData.user.id;

    const url = new URL(req.url);
    const monthOffset = Math.max(0, parseInt(url.searchParams.get("month_offset") || "0"));
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - monthOffset + 1, 1);

    const [accountsRes, jobsRes, tplRes] = await Promise.all([
      admin.from("whatsapp_accounts").select("id, name, phone_number_id, business_account_id, access_token").eq("user_id", userId),
      admin
        .from("broadcast_jobs")
        .select("id, account_id, account_ids, template_id, sent_count, delivered_count, created_at, status")
        .eq("user_id", userId)
        .gte("created_at", start.toISOString())
        .lt("created_at", end.toISOString()),
      admin.from("chat_templates").select("id, category").eq("user_id", userId),
    ]);

    const accounts = accountsRes.data || [];
    const jobs = jobsRes.data || [];
    const tpls = tplRes.data || [];
    const tplCat = new Map(tpls.map((t) => [t.id, inferCategory(t.category)]));

    const byAccount = new Map<string, {
      account_id: string;
      display_name: string;
      phone_number: string;
      sent: number;
      delivered: number;
      cost_usd: number;
      by_category: Record<string, number>;
      meta_amount_usd?: number;
    }>();
    for (const a of accounts) {
      byAccount.set(a.id, {
        account_id: a.id,
        display_name: a.name || a.phone_number_id || "Conta",
        phone_number: a.phone_number_id || "",
        sent: 0,
        delivered: 0,
        cost_usd: 0,
        by_category: { marketing: 0, utility: 0, authentication: 0, service: 0 },
      });
    }
    const unassigned = { account_id: "", display_name: "Sem conta", phone_number: "", sent: 0, delivered: 0, cost_usd: 0, by_category: { marketing: 0, utility: 0, authentication: 0, service: 0 } as Record<string, number> };

    let totalSent = 0, totalDelivered = 0, totalCostUsd = 0;

    for (const j of jobs) {
      const s = j.sent_count || 0;
      const d = j.delivered_count || 0;
      const cat = (j.template_id && tplCat.get(j.template_id)) || "marketing";
      const price = PRICING[cat as keyof typeof PRICING] ?? PRICING.marketing;
      const cost = s * price;
      totalSent += s;
      totalDelivered += d;
      totalCostUsd += cost;

      const targets: string[] = [];
      if (j.account_id) targets.push(j.account_id);
      if (Array.isArray(j.account_ids)) for (const a of j.account_ids) if (a && !targets.includes(a)) targets.push(a);

      if (targets.length === 0) {
        unassigned.sent += s;
        unassigned.delivered += d;
        unassigned.cost_usd += cost;
        unassigned.by_category[cat] += cost;
      } else {
        const share = 1 / targets.length;
        for (const aid of targets) {
          const row = byAccount.get(aid);
          if (!row) continue;
          row.sent += s * share;
          row.delivered += d * share;
          row.cost_usd += cost * share;
          row.by_category[cat] += cost * share;
        }
      }
    }

    // Try to enrich with Meta Graph billing (best effort, ignore failures)
    const metaToken = Deno.env.get("META_SYSTEM_USER_TOKEN");
    if (metaToken) {
      const sinceUnix = Math.floor(start.getTime() / 1000);
      const untilUnix = Math.floor((Math.min(end.getTime(), Date.now())) / 1000);
      await Promise.all(accounts.map(async (a: any) => {
        if (!a.business_account_id) return;
        try {
          const t = a.access_token || metaToken;
          const u = `https://graph.facebook.com/v20.0/${a.business_account_id}/conversation_analytics?start=${sinceUnix}&end=${untilUnix}&granularity=MONTHLY&metric_types=%5B%22COST%22%5D&access_token=${encodeURIComponent(t)}`;
          const r = await fetch(u);
          if (!r.ok) return;
          const d = await r.json();
          const points = d?.conversation_analytics?.data?.[0]?.data_points || [];
          const cost = points.reduce((s: number, p: any) => s + Number(p.cost || 0), 0);
          if (cost > 0) {
            const row = byAccount.get(a.id);
            if (row) row.meta_amount_usd = cost;
          }
        } catch (_e) { /* ignore */ }
      }));
    }

    const rows = [...byAccount.values(), ...(unassigned.sent > 0 ? [unassigned] : [])].map((r) => ({
      ...r,
      cost_brl: +(r.cost_usd * USD_TO_BRL).toFixed(2),
      cost_usd: +r.cost_usd.toFixed(4),
      meta_amount_brl: r.meta_amount_usd ? +(r.meta_amount_usd * USD_TO_BRL).toFixed(2) : undefined,
    })).sort((a, b) => b.cost_usd - a.cost_usd);

    return json({
      month: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`,
      total_sent: Math.round(totalSent),
      total_delivered: Math.round(totalDelivered),
      total_cost_usd: +totalCostUsd.toFixed(4),
      total_cost_brl: +(totalCostUsd * USD_TO_BRL).toFixed(2),
      usd_to_brl: USD_TO_BRL,
      accounts: rows,
    });
  } catch (err: any) {
    console.error("spend-metrics error:", err);
    return json({ error: err?.message || "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
