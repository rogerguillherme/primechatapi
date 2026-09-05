import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GRAPH = "https://graph.facebook.com/v19.0";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "Unauthorized" }, 401);

    // Counts by window
    const now = Date.now();
    const since1h = new Date(now - 3600 * 1000).toISOString();
    const since24h = new Date(now - 86400 * 1000).toISOString();
    const since7d = new Date(now - 7 * 86400 * 1000).toISOString();

    async function countSince(iso: string, processed?: boolean) {
      let q = admin
        .from("instagram_webhook_events")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .gte("received_at", iso);
      if (typeof processed === "boolean") q = q.eq("processed", processed);
      const { count } = await q;
      return count || 0;
    }

    const [last1h, last24h, last7d, failed24h, totalFailed] = await Promise.all([
      countSince(since1h),
      countSince(since24h),
      countSince(since7d),
      countSince(since24h, false),
      admin.from("instagram_webhook_events").select("*", { count: "exact", head: true }).eq("user_id", user.id).eq("processed", false).then(r => r.count || 0),
    ]);

    // Recent failed events (10 most recent unprocessed)
    const { data: failed } = await admin
      .from("instagram_webhook_events")
      .select("id, entry_id, event_type, error, attempts, received_at")
      .eq("user_id", user.id)
      .eq("processed", false)
      .order("received_at", { ascending: false })
      .limit(20);

    // Last successful event
    const { data: lastOk } = await admin
      .from("instagram_webhook_events")
      .select("received_at, event_type")
      .eq("user_id", user.id)
      .eq("processed", true)
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Subscribed apps status per connection
    const { data: connections } = await admin
      .from("instagram_connections")
      .select("id, instagram_username, page_id, instagram_user_id, access_token, status")
      .eq("user_id", user.id)
      .eq("status", "connected");

    const subscriptions = [] as any[];
    for (const c of connections || []) {
      let pageToken = c.access_token;
      try {
        const tr = await fetch(`${GRAPH}/${c.page_id}?fields=access_token&access_token=${c.access_token}`);
        const td = await tr.json();
        if (tr.ok && td.access_token) pageToken = td.access_token;
      } catch { /* ignore */ }

      let pageFields: string[] = [];
      let igFields: string[] = [];
      try {
        const r = await fetch(`${GRAPH}/${c.page_id}/subscribed_apps?access_token=${pageToken}`);
        const d = await r.json();
        if (Array.isArray(d.data) && d.data[0]) pageFields = d.data[0].subscribed_fields || [];
      } catch { /* ignore */ }
      try {
        const r = await fetch(`${GRAPH}/${c.instagram_user_id}/subscribed_apps?access_token=${pageToken}`);
        const d = await r.json();
        if (Array.isArray(d.data) && d.data[0]) igFields = d.data[0].subscribed_fields || [];
      } catch { /* ignore */ }

      subscriptions.push({
        connection_id: c.id,
        username: c.instagram_username,
        page_subscribed: pageFields,
        ig_subscribed: igFields,
        page_ok: ["messages", "messaging_postbacks"].every(f => pageFields.includes(f)),
        ig_ok: ["comments", "messages"].every(f => igFields.includes(f)),
      });
    }

    return json({
      ok: true,
      counts: { last_1h: last1h, last_24h: last24h, last_7d: last7d, failed_24h: failed24h, total_failed: totalFailed },
      last_successful_at: lastOk?.received_at || null,
      last_successful_type: lastOk?.event_type || null,
      failed_events: failed || [],
      subscriptions,
      verify_url: `${supabaseUrl}/functions/v1/instagram-webhook`,
    });
  } catch (e) {
    return json({ error: (e as Error).message || "Erro interno" }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
