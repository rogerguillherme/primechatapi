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

// WhatsApp Cloud API pricing (USD per message/conversation, BR — fallback only)
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

function normalizeDigits(value: unknown): string {
  return String(value || "").replace(/\D/g, "");
}

function collectMetricPoints(payload: any): any[] {
  const points: any[] = [];
  const visit = (node: any) => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node !== "object") return;
    if ("cost" in node || "volume" in node || "conversation" in node) {
      points.push(node);
    }
    if (Array.isArray(node.data_points)) visit(node.data_points);
    if (Array.isArray(node.data)) visit(node.data);
    if (node.pricing_analytics) visit(node.pricing_analytics);
    if (node.conversation_analytics) visit(node.conversation_analytics);
  };
  visit(payload);
  return points;
}

function metaCostToUsd(cost: number, point: any): number {
  // Meta returns pricing_analytics cost in the WABA billing currency and often
  // omits the currency field. Prime Chat accounts are BR numbers/BMs, so BRL is
  // the safe default when Meta does not send an explicit currency.
  const currency = String(point?.currency || point?.cost_currency || point?.billing_currency || "BRL").toUpperCase();
  if (currency === "BRL" || currency === "R$") return cost / USD_TO_BRL;
  return cost;
}

async function fetchJson(url: string) {
  const response = await fetch(url);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function fetchMetaPhones(wabaId: string, token: string) {
  const url = new URL(`https://graph.facebook.com/v25.0/${wabaId}/phone_numbers`);
  url.searchParams.set("fields", "id,display_phone_number,verified_name");
  url.searchParams.set("access_token", token);
  const { response, body } = await fetchJson(url.toString());
  if (!response.ok) return [] as any[];
  return Array.isArray(body?.data) ? body.data : [];
}

async function fetchPricingAnalytics(wabaId: string, token: string, sinceUnix: number, untilUnix: number) {
  const url = new URL(`https://graph.facebook.com/v25.0/${wabaId}/pricing_analytics`);
  url.searchParams.set("start", String(sinceUnix));
  url.searchParams.set("end", String(untilUnix));
  // MONTHLY can return an empty array for the current open month; DAILY returns
  // the real billed points and we aggregate them locally.
  url.searchParams.set("granularity", "DAILY");
  url.searchParams.set("metric_types", JSON.stringify(["COST", "VOLUME"]));
  url.searchParams.set("dimensions", JSON.stringify(["PHONE", "PRICING_CATEGORY"]));
  url.searchParams.set("access_token", token);
  return fetchJson(url.toString());
}

async function fetchConversationAnalytics(wabaId: string, token: string, sinceUnix: number, untilUnix: number) {
  const fields = `conversation_analytics.start(${sinceUnix}).end(${untilUnix}).granularity(MONTHLY).metric_types(["COST"]).dimensions(["PHONE","CONVERSATION_CATEGORY"])`;
  const url = new URL(`https://graph.facebook.com/v25.0/${wabaId}`);
  url.searchParams.set("fields", fields);
  url.searchParams.set("access_token", token);
  return fetchJson(url.toString());
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

    // Also count outbound chat_messages per account (covers individual sends
    // and flow-triggered messages that don't go through broadcast_jobs).
    await Promise.all(accounts.map(async (a: any) => {
      const row = byAccount.get(a.id);
      if (!row) return;
      const { count: sentCount } = await admin
        .from("chat_messages")
        .select("id", { count: "exact", head: true })
        .eq("direction", "outbound")
        .eq("account_id", a.id)
        .gte("created_at", start.toISOString())
        .lt("created_at", end.toISOString())
        .in("status", ["sent", "delivered", "read", "accepted"]);
      const { count: deliveredCount } = await admin
        .from("chat_messages")
        .select("id", { count: "exact", head: true })
        .eq("direction", "outbound")
        .eq("account_id", a.id)
        .gte("created_at", start.toISOString())
        .lt("created_at", end.toISOString())
        .in("status", ["delivered", "read"]);
      const s = sentCount || 0;
      const d = deliveredCount || 0;
      if (s === 0) return;
      // Default to marketing pricing for individual sends (no template category context).
      const price = PRICING.marketing;
      const cost = s * price;
      row.sent += s;
      row.delivered += d;
      row.cost_usd += cost;
      row.by_category.marketing += cost;
      totalSent += s;
      totalDelivered += d;
      totalCostUsd += cost;
    }));

    // Fetch real Meta Graph billing (source of truth). Meta moved WhatsApp
    // billing from conversation_analytics to pricing_analytics with per-message
    // pricing, so pricing_analytics is tried first and conversation_analytics
    // remains only as a legacy fallback.
    const metaToken = Deno.env.get("META_SYSTEM_USER_TOKEN");
    const sinceUnix = Math.floor(start.getTime() / 1000);
    const untilUnix = Math.floor((Math.min(end.getTime(), Date.now())) / 1000);
    const metaDebug: Record<string, string> = {};
    let totalMetaUsd = 0;

    const accountsByWaba = new Map<string, any[]>();
    for (const account of accounts) {
      if (!account.business_account_id || !/^\d+$/.test(String(account.business_account_id))) {
        metaDebug[account.id] = "no_waba";
        continue;
      }
      const list = accountsByWaba.get(account.business_account_id) || [];
      list.push(account);
      accountsByWaba.set(account.business_account_id, list);
    }

    await Promise.all([...accountsByWaba.entries()].map(async ([wabaId, wabaAccounts]) => {
      const tokenCandidates = [metaToken, ...wabaAccounts.map((a) => a.access_token)].filter((t, i, arr): t is string => Boolean(t) && arr.indexOf(t) === i);
      if (tokenCandidates.length === 0) {
        for (const a of wabaAccounts) metaDebug[a.id] = "no_token";
        return;
      }

      let selectedToken = "";
      let selectedPayload: any = null;
      let selectedPoints: any[] = [];
      let selectedSource = "pricing";
      let lastError = "unknown";

      for (const token of tokenCandidates) {
        try {
          const pricing = await fetchPricingAnalytics(wabaId, token, sinceUnix, untilUnix);
          if (pricing.response.ok) {
            const points = collectMetricPoints(pricing.body);
            selectedToken = token;
            selectedPayload = pricing.body;
            selectedPoints = points;
            selectedSource = "pricing";
            break;
          }
          lastError = `pricing_${pricing.response.status}:${pricing.body?.error?.message || "unknown"}`;

          const conversation = await fetchConversationAnalytics(wabaId, token, sinceUnix, untilUnix);
          if (conversation.response.ok) {
            const points = collectMetricPoints(conversation.body);
            selectedToken = token;
            selectedPayload = conversation.body;
            selectedPoints = points;
            selectedSource = "conversation";
            break;
          }
          lastError = `conversation_${conversation.response.status}:${conversation.body?.error?.message || lastError}`;
        } catch (e: any) {
          lastError = `exc:${e?.message || e}`;
        }
      }

      if (!selectedToken || !selectedPayload) {
        for (const a of wabaAccounts) metaDebug[a.id] = lastError;
        return;
      }

      const phoneNodes = await fetchMetaPhones(wabaId, selectedToken).catch(() => [] as any[]);
      const accountMatchers = new Map<string, string>();
      for (const a of wabaAccounts) {
        accountMatchers.set(normalizeDigits(a.phone_number_id), a.id);
      }
      for (const phone of phoneNodes) {
        const matchingAccount = wabaAccounts.find((a) => String(a.phone_number_id) === String(phone.id));
        if (!matchingAccount) continue;
        const row = byAccount.get(matchingAccount.id);
        if (row && phone.display_phone_number) row.phone_number = phone.display_phone_number;
        accountMatchers.set(normalizeDigits(phone.id), matchingAccount.id);
        accountMatchers.set(normalizeDigits(phone.display_phone_number), matchingAccount.id);
      }

      const metaByAccount = new Map<string, { cost_usd: number; by_category: Record<string, number>; volume: number; hasPoint: boolean }>();
      for (const a of wabaAccounts) {
        metaByAccount.set(a.id, { cost_usd: 0, by_category: { marketing: 0, utility: 0, authentication: 0, service: 0 }, volume: 0, hasPoint: false });
      }

      for (const point of selectedPoints) {
        const rawCost = Number(point?.cost || 0);
        const costUsd = metaCostToUsd(rawCost, point);
        const category = inferCategory(point?.pricing_category || point?.conversation_category || point?.category);
        const volume = Number(point?.volume || point?.conversation || 0);
        const phoneKey = normalizeDigits(point?.phone_number || point?.phone || point?.display_phone_number || point?.phone_number_id);
        let targetId = phoneKey ? accountMatchers.get(phoneKey) : undefined;

        if (!targetId && wabaAccounts.length === 1) {
          targetId = wabaAccounts[0].id;
        }

        if (!targetId && wabaAccounts.length > 1) {
          const totalWabaSent = wabaAccounts.reduce((sum, a) => sum + ((byAccount.get(a.id)?.sent || 0)), 0);
          for (const a of wabaAccounts) {
            const share = totalWabaSent > 0 ? ((byAccount.get(a.id)?.sent || 0) / totalWabaSent) : (1 / wabaAccounts.length);
            const bucket = metaByAccount.get(a.id);
            if (!bucket) continue;
            bucket.cost_usd += costUsd * share;
            bucket.by_category[category] += costUsd * share;
            bucket.volume += volume * share;
            bucket.hasPoint = true;
          }
          continue;
        }

        const bucket = targetId ? metaByAccount.get(targetId) : undefined;
        if (!bucket) continue;
        bucket.cost_usd += costUsd;
        bucket.by_category[category] += costUsd;
        bucket.volume += volume;
        bucket.hasPoint = true;
      }

      for (const a of wabaAccounts) {
        const row = byAccount.get(a.id);
        const meta = metaByAccount.get(a.id);
        if (!row || !meta || !meta.hasPoint) {
          metaDebug[a.id] = `${selectedSource}_ok:no_points_for_number`;
          continue;
        }
        totalCostUsd -= row.cost_usd;
        row.cost_usd = meta.cost_usd;
        row.by_category = meta.by_category;
        row.meta_amount_usd = meta.cost_usd;
        totalCostUsd += meta.cost_usd;
        totalMetaUsd += meta.cost_usd;
        metaDebug[a.id] = `${selectedSource}_ok:${meta.cost_usd.toFixed(4)}:${Math.round(meta.volume)}_volume`;
      }
    }));

    const rows = [...byAccount.values(), ...(unassigned.sent > 0 ? [unassigned] : [])].map((r) => ({
      ...r,
      cost_brl: +(r.cost_usd * USD_TO_BRL).toFixed(2),
      cost_usd: +r.cost_usd.toFixed(4),
      meta_amount_brl: r.meta_amount_usd !== undefined ? +(r.meta_amount_usd * USD_TO_BRL).toFixed(2) : undefined,
    })).sort((a, b) => b.cost_usd - a.cost_usd);

    const anyMeta = rows.some((r) => r.meta_amount_usd !== undefined);

    return json({
      month: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`,
      total_sent: Math.round(totalSent),
      total_delivered: Math.round(totalDelivered),
      total_cost_usd: +totalCostUsd.toFixed(4),
      total_cost_brl: +(totalCostUsd * USD_TO_BRL).toFixed(2),
      total_meta_usd: +totalMetaUsd.toFixed(4),
      total_meta_brl: +(totalMetaUsd * USD_TO_BRL).toFixed(2),
      source: anyMeta ? "meta" : "estimate",
      usd_to_brl: USD_TO_BRL,
      accounts: rows,
      meta_debug: metaDebug,
    });
  } catch (err: any) {
    console.error("spend-metrics error:", err);
    return json({ error: err?.message || "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
