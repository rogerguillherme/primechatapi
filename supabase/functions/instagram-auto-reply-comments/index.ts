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
    const { data: { user }, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);

    // Body opcional: { max_posts?: number, max_comments_per_post?: number }
    const body = await req.json().catch(() => ({}));
    const MAX_POSTS = Math.min(Math.max(body.max_posts ?? 10, 1), 25);
    const MAX_COMMENTS = Math.min(Math.max(body.max_comments_per_post ?? 25, 1), 50);

    // Get connection
    const { data: connection } = await admin
      .from("instagram_connections")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "connected")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!connection) return json({ error: "Nenhuma conta Instagram conectada" }, 404);

    // Resolve page token
    let pageToken = connection.access_token;
    if (connection.page_id) {
      try {
        const r = await fetch(`${GRAPH}/${connection.page_id}?fields=access_token&access_token=${connection.access_token}`);
        const d = await r.json();
        if (r.ok && d.access_token) pageToken = d.access_token;
      } catch { /* ignore */ }
    }
    const conn = { ...connection, access_token: pageToken };
    const ownUsername = (connection.instagram_username || "").toLowerCase();

    // Load active comment automations
    const { data: automations } = await admin
      .from("instagram_automations")
      .select("*, instagram_automation_steps(*)")
      .eq("user_id", user.id)
      .eq("active", true)
      .in("trigger_type", ["any_comment", "comment_keyword"]);

    if (!automations || automations.length === 0) {
      return json({ ok: true, message: "Nenhuma automação ativa", processed: 0 });
    }

    // Fetch recent posts
    const mediaUrl = `${GRAPH}/${connection.instagram_user_id}/media?fields=id,caption,timestamp&limit=${MAX_POSTS}&access_token=${pageToken}`;
    const mr = await fetch(mediaUrl);
    const md = await mr.json();
    if (!mr.ok) return json({ error: md?.error?.message || "Erro ao listar posts" }, 500);
    const mediaList = md.data || [];

    let totalScanned = 0;
    let totalMatched = 0;
    let totalSkippedAlreadyReplied = 0;
    const results: any[] = [];

    for (const media of mediaList) {
      // Get comments + replies
      const cUrl = `${GRAPH}/${media.id}/comments?fields=id,text,username,timestamp,user{id,username},replies{id,username,text}&limit=${MAX_COMMENTS}&access_token=${pageToken}`;
      const cr = await fetch(cUrl);
      const cd = await cr.json();
      if (!cr.ok) continue;
      const comments = cd.data || [];

      for (const c of comments) {
        totalScanned++;
        // Pula se já tivermos respondido (qualquer reply do próprio usuário)
        const replies = c.replies?.data || [];
        const alreadyReplied = replies.some((r: any) => (r.username || "").toLowerCase() === ownUsername);
        if (alreadyReplied) {
          totalSkippedAlreadyReplied++;
          continue;
        }
        // Não responder a si mesmo
        if ((c.username || "").toLowerCase() === ownUsername) continue;

        const text = (c.text || "").trim();
        const lower = text.toLowerCase();
        const username = c.username || "amigo(a)";

        let matched = false;
        for (const automation of automations) {
          let trigger = false;
          if (automation.trigger_type === "any_comment") trigger = true;
          else if (automation.trigger_type === "comment_keyword") {
            const kws: string[] = automation.keywords || [];
            trigger = kws.some((kw) => lower.includes(kw.toLowerCase().trim()));
          }
          if (!trigger) continue;

          matched = true;
          const stepsResult = await runSteps(automation.instagram_automation_steps || [], conn, {
            username,
            text,
            commentId: c.id,
            senderId: c.user?.id,
          });
          results.push({
            media_id: media.id,
            comment_id: c.id,
            username,
            automation: automation.name,
            steps: stepsResult,
          });
          break; // Uma automação por comentário
        }
        if (matched) totalMatched++;
      }
    }

    return json({
      ok: true,
      scanned: totalScanned,
      matched: totalMatched,
      skipped_already_replied: totalSkippedAlreadyReplied,
      posts_checked: mediaList.length,
      results,
    });
  } catch (error) {
    console.error("instagram-auto-reply-comments error:", error);
    return json({ error: (error as Error).message || "Erro interno" }, 500);
  }
});

async function runSteps(
  steps: any[],
  conn: any,
  ctx: { username: string; text: string; commentId?: string; senderId?: string }
) {
  const sorted = (steps || []).sort((a: any, b: any) => a.step_order - b.step_order);
  const results: any[] = [];

  for (const step of sorted) {
    const rawMessage = step.message || "";
    const variants = rawMessage.split("|||").map((s: string) => s.trim()).filter(Boolean);
    const picked = variants.length > 0 ? variants[Math.floor(Math.random() * variants.length)] : "";
    const message = picked
      .replace(/\{\{nome\}\}/gi, ctx.username)
      .replace(/\{nome\}/gi, ctx.username)
      .replace(/\{\{comentario\}\}/gi, ctx.text)
      .replace(/\{comentario\}/gi, ctx.text);

    if (step.step_type === "delay") {
      const sec = step.delay_seconds || 5;
      await new Promise((r) => setTimeout(r, sec * 1000));
      results.push({ type: "delay", seconds: sec, ok: true });
    } else if (step.step_type === "reply_comment" && ctx.commentId) {
      const r = await fetch(`${GRAPH}/${ctx.commentId}/replies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, access_token: conn.access_token }),
      });
      const d = await r.json();
      results.push({ type: "reply_comment", ok: r.ok, message, response: d });
    } else if (step.step_type === "send_dm") {
      if (ctx.commentId) {
        const r = await fetch(`${GRAPH}/${ctx.commentId}/private_replies`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, access_token: conn.access_token }),
        });
        const d = await r.json();
        results.push({ type: "send_dm_private_reply", ok: r.ok, message, response: d });
      } else if (ctx.senderId) {
        const r = await fetch(`${GRAPH}/me/messages?access_token=${conn.access_token}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipient: { id: ctx.senderId }, message: { text: message } }),
        });
        const d = await r.json();
        results.push({ type: "send_dm", ok: r.ok, message, response: d });
      }
    }
  }
  return results;
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
