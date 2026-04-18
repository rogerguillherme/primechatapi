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

    const { data: connection } = await admin
      .from("instagram_connections")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "connected")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!connection) return json({ error: "Nenhuma conta Instagram conectada" }, 404);

    const pageAccessToken = await resolvePageAccessToken(connection);

    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "sync";

    if (action === "sync" && req.method === "POST") {
      const result = await syncConversations(admin, connection, pageAccessToken);
      return json(result);
    }

    if (action === "messages" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const { conversation_id, ig_thread_id } = body;
      if (!conversation_id) return json({ error: "conversation_id obrigatório" }, 400);
      const result = await syncThreadMessages(admin, connection, pageAccessToken, conversation_id, ig_thread_id);
      return json(result);
    }

    if (action === "send" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const { conversation_id, text } = body;
      if (!conversation_id || !text?.trim()) return json({ error: "conversation_id e text obrigatórios" }, 400);

      const { data: conv } = await admin
        .from("instagram_conversations")
        .select("*")
        .eq("id", conversation_id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!conv) return json({ error: "Conversa não encontrada" }, 404);

      const sent = await sendInstagramDM(pageAccessToken, connection.page_id, conv.participant_id, text);
      if (!sent.ok) return json({ error: "Falha no envio", details: sent.data }, 422);

      await admin.from("instagram_messages").insert({
        conversation_id,
        user_id: user.id,
        ig_message_id: sent.data?.message_id || null,
        direction: "outbound",
        text,
        status: "sent",
      });

      await admin
        .from("instagram_conversations")
        .update({
          last_message_text: text,
          last_message_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", conversation_id);

      return json({ ok: true, message_id: sent.data?.message_id });
    }

    if (action === "mark_read" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const { conversation_id } = body;
      if (!conversation_id) return json({ error: "conversation_id obrigatório" }, 400);
      await admin
        .from("instagram_conversations")
        .update({ unread_count: 0 })
        .eq("id", conversation_id)
        .eq("user_id", user.id);
      return json({ ok: true });
    }

    return json({ error: "Ação não suportada" }, 400);
  } catch (error) {
    console.error("instagram-messages error:", error);
    return json({ error: (error as Error).message || "Erro interno" }, 500);
  }
});

async function resolvePageAccessToken(conn: any) {
  if (!conn?.page_id || !conn?.access_token) return conn?.access_token;
  try {
    const r = await fetch(`${GRAPH}/${conn.page_id}?fields=access_token&access_token=${conn.access_token}`);
    const d = await r.json();
    return r.ok && d?.access_token ? d.access_token : conn.access_token;
  } catch {
    return conn.access_token;
  }
}

async function syncConversations(admin: any, conn: any, accessToken: string) {
  const igId = conn.instagram_user_id;
  const r = await fetch(
    `${GRAPH}/${igId}/conversations?platform=instagram&fields=id,updated_time,participants,messages.limit(1){id,from,to,message,created_time}&limit=50&access_token=${accessToken}`
  );
  const data = await r.json();
  if (!r.ok) {
    console.error("syncConversations error:", data);
    return { error: "Falha ao listar conversas", details: data };
  }

  const threads = data.data || [];
  let upserted = 0;

  for (const t of threads) {
    const participants = t.participants?.data || [];
    const other = participants.find((p: any) => String(p.id) !== String(igId));
    if (!other) continue;

    const lastMsg = t.messages?.data?.[0];
    const lastText = lastMsg?.message || "";
    const lastAt = lastMsg?.created_time || t.updated_time;

    // Try fetch profile for username/avatar
    let username = other.username || other.name || null;
    let avatar: string | null = null;
    try {
      const pr = await fetch(`${GRAPH}/${other.id}?fields=name,username,profile_pic&access_token=${accessToken}`);
      const pd = await pr.json();
      if (pr.ok) {
        username = pd.username || pd.name || username;
        avatar = pd.profile_pic || null;
      }
    } catch { /* ignore */ }

    const { data: existing } = await admin
      .from("instagram_conversations")
      .select("id")
      .eq("ig_user_id", igId)
      .eq("participant_id", other.id)
      .maybeSingle();

    if (existing) {
      await admin
        .from("instagram_conversations")
        .update({
          last_message_text: lastText,
          last_message_at: lastAt,
          participant_username: username,
          participant_avatar_url: avatar,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
    } else {
      await admin.from("instagram_conversations").insert({
        user_id: conn.user_id,
        connection_id: conn.id,
        ig_user_id: igId,
        participant_id: other.id,
        participant_username: username,
        participant_name: other.name || username,
        participant_avatar_url: avatar,
        last_message_text: lastText,
        last_message_at: lastAt,
      });
    }
    upserted++;
  }

  return { ok: true, upserted };
}

async function syncThreadMessages(admin: any, conn: any, accessToken: string, conversationId: string, igThreadIdHint?: string) {
  const { data: conv } = await admin
    .from("instagram_conversations")
    .select("*")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv) return { error: "conv not found" };

  // Find thread id by participant
  let threadId = igThreadIdHint || null;
  if (!threadId) {
    const lr = await fetch(
      `${GRAPH}/${conv.ig_user_id}/conversations?platform=instagram&user_id=${conv.participant_id}&access_token=${accessToken}`
    );
    const ld = await lr.json();
    threadId = ld?.data?.[0]?.id || null;
  }
  if (!threadId) return { ok: true, count: 0 };

  const r = await fetch(
    `${GRAPH}/${threadId}?fields=messages.limit(50){id,from,to,message,created_time}&access_token=${accessToken}`
  );
  const data = await r.json();
  if (!r.ok) return { error: "fail", details: data };

  const messages = data.messages?.data || [];
  let inserted = 0;
  for (const m of messages.reverse()) {
    if (!m.message) continue;
    const fromId = m.from?.id;
    const direction = String(fromId) === String(conv.ig_user_id) ? "outbound" : "inbound";
    const { error } = await admin.from("instagram_messages").insert({
      conversation_id: conversationId,
      user_id: conv.user_id,
      ig_message_id: m.id,
      direction,
      text: m.message,
      status: "received",
      created_at: m.created_time,
    });
    if (!error) inserted++;
  }

  await admin
    .from("instagram_conversations")
    .update({ unread_count: 0 })
    .eq("id", conversationId);

  return { ok: true, inserted };
}

async function sendInstagramDM(accessToken: string, pageId: string, recipientId: string, message: string) {
  const r = await fetch(`${GRAPH}/${pageId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text: message },
      messaging_type: "RESPONSE",
      access_token: accessToken,
    }),
  });
  const data = await r.json();
  return { ok: r.ok, data };
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
