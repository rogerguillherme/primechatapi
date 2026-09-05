import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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

    const { event_ids, all_failed } = await req.json().catch(() => ({}));

    let ids: string[] = Array.isArray(event_ids) ? event_ids : [];
    if (all_failed) {
      const { data } = await admin
        .from("instagram_webhook_events")
        .select("id")
        .eq("user_id", user.id)
        .eq("processed", false)
        .order("received_at", { ascending: false })
        .limit(50);
      ids = (data || []).map((e: any) => e.id);
    }

    if (!ids.length) return json({ ok: true, reprocessed: 0 });

    const { data: events } = await admin
      .from("instagram_webhook_events")
      .select("id, payload, attempts")
      .eq("user_id", user.id)
      .in("id", ids);

    const webhookUrl = `${supabaseUrl}/functions/v1/instagram-webhook`;
    let success = 0;
    let failed = 0;

    for (const ev of events || []) {
      try {
        await admin.from("instagram_webhook_events").update({
          attempts: (ev.attempts || 0) + 1,
        }).eq("id", ev.id);

        const entry = (ev.payload as any)?.entry;
        const obj = (ev.payload as any)?.object || "instagram";
        const body = { object: obj, entry: entry ? [entry] : [] };

        const r = await fetch(webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-reprocess-event-id": ev.id,
          },
          body: JSON.stringify(body),
        });
        if (r.ok) {
          success++;
          await admin.from("instagram_webhook_events").update({
            processed: true,
            processed_at: new Date().toISOString(),
            error: null,
          }).eq("id", ev.id);
        } else {
          failed++;
          await admin.from("instagram_webhook_events").update({
            error: `Reprocess HTTP ${r.status}`,
          }).eq("id", ev.id);
        }
      } catch (e) {
        failed++;
        await admin.from("instagram_webhook_events").update({
          error: (e as Error).message || String(e),
        }).eq("id", ev.id);
      }
    }

    return json({ ok: true, reprocessed: success, failed });
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
