import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GRAPH = "https://graph.facebook.com/v19.0";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: { user }, error: userError } = await adminClient.auth.getUser(token);
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const { data: connection } = await adminClient
      .from("instagram_connections")
      .select("*")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!connection) return json({ error: "Nenhuma conta Instagram conectada" }, 404);

    const accessToken = connection.access_token;
    const igUserId = connection.instagram_user_id;

    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "list";

    // --- LIST: comments for a media OR aggregate from recent media ---
    if (action === "list" && req.method === "GET") {
      const mediaId = url.searchParams.get("media_id");

      if (mediaId) {
        const r = await fetch(
          `${GRAPH}/${mediaId}/comments?fields=id,text,username,timestamp,like_count,user{id,username,profile_picture_url},replies{id,text,username,timestamp,like_count}&limit=50&access_token=${accessToken}`
        );
        const data = await r.json();
        if (!r.ok) return json({ error: "Erro ao listar comentários", details: data }, 422);
        return json({ comments: data.data || [] });
      }

      // No media_id: return recent media list w/ comments_count for the index view
      const r = await fetch(
        `${GRAPH}/${igUserId}/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count&limit=25&access_token=${accessToken}`
      );
      const data = await r.json();
      if (!r.ok) return json({ error: "Erro ao listar mídias", details: data }, 422);
      return json({ media: data.data || [] });
    }

    if (req.method !== "POST" && req.method !== "DELETE") {
      return json({ error: "Method not allowed" }, 405);
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    // --- REPLY ---
    if (action === "reply") {
      const { comment_id, message } = body as { comment_id?: string; message?: string };
      if (!comment_id || !message?.trim()) return json({ error: "comment_id e message obrigatórios" }, 400);
      const r = await fetch(`${GRAPH}/${comment_id}/replies?access_token=${accessToken}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = await r.json();
      if (!r.ok) return json({ error: "Erro ao responder", details: data }, 422);
      return json({ ok: true, id: data.id });
    }

    // --- LIKE / HIDE / UNHIDE (Instagram Graph "hide" toggle on a comment) ---
    if (action === "hide" || action === "unhide") {
      const { comment_id } = body as { comment_id?: string };
      if (!comment_id) return json({ error: "comment_id obrigatório" }, 400);
      const r = await fetch(`${GRAPH}/${comment_id}?access_token=${accessToken}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hide: action === "hide" }),
      });
      const data = await r.json();
      if (!r.ok) return json({ error: "Erro ao ocultar/exibir", details: data }, 422);
      return json({ ok: true });
    }

    // --- DELETE ---
    if (action === "delete" && req.method === "DELETE") {
      const commentId = url.searchParams.get("comment_id");
      if (!commentId) return json({ error: "comment_id obrigatório" }, 400);
      const r = await fetch(`${GRAPH}/${commentId}?access_token=${accessToken}`, { method: "DELETE" });
      const data = await r.json();
      if (!r.ok) return json({ error: "Erro ao excluir", details: data }, 422);
      return json({ ok: true });
    }

    return json({ error: "Ação não suportada" }, 400);
  } catch (error) {
    console.error("instagram-comments error:", error);
    return json({ error: (error as Error).message || "Erro interno" }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
