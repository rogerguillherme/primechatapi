import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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
    const { data: claims, error: cerr } = await admin.auth.getClaims(token);
    if (cerr || !claims?.claims?.sub) return json({ error: "Unauthorized" }, 401);
    const userId = claims.claims.sub;

    const { data: connections } = await admin
      .from("instagram_connections")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });

    if (!connections?.length) return json({ error: "Nenhuma conexão Instagram encontrada" }, 404);

    const results = [];
    for (const conn of connections) {
      // Resolve page access token
      let pageToken = conn.access_token;
      if (conn.page_id) {
        try {
          const tr = await fetch(`${GRAPH}/${conn.page_id}?fields=access_token&access_token=${conn.access_token}`);
          const td = await tr.json();
          if (tr.ok && td.access_token) pageToken = td.access_token;
        } catch { /* ignore */ }
      }

      // Subscribe Page to messages + comments + mentions
      const fields = "messages,messaging_postbacks,messaging_optins,message_reads,messaging_referrals,feed";
      const sub = await fetch(`${GRAPH}/${conn.page_id}/subscribed_apps?subscribed_fields=${fields}&access_token=${pageToken}`, {
        method: "POST",
      });
      const subData = await sub.json();

      // Subscribe Instagram User to comments + messages + mentions
      const igFields = "comments,messages,mentions,message_reactions,story_insights";
      const igSub = await fetch(`${GRAPH}/${conn.instagram_user_id}/subscribed_apps?subscribed_fields=${igFields}&access_token=${pageToken}`, {
        method: "POST",
      });
      const igSubData = await igSub.json();

      results.push({
        username: conn.instagram_username,
        page_subscribe: { ok: sub.ok, data: subData },
        ig_subscribe: { ok: igSub.ok, data: igSubData },
      });
    }

    return json({ ok: true, results });
  } catch (error) {
    console.error("instagram-subscribe-webhook error:", error);
    return json({ error: (error as Error).message || "Erro interno" }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
