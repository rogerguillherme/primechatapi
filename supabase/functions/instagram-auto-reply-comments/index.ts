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
    const allowedCronKeys = [
      Deno.env.get("SUPABASE_ANON_KEY"),
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY"),
      Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"),
      Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")?.split(",")?.[0],
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJIUzI1NiIsInJlZiI6Im5uandlbW1lcnVtemtpaXlrcGFzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1NDEwNDcsImV4cCI6MjA4NzExNzA0N30._GKCqMhMBR3j0jK438raMweCb2Bf_LMs-BuCwAPLQ48",
    ].flatMap((value) => (value || "").split(",").map((key) => key.trim())).filter(Boolean);
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const body = await req.json().catch(() => ({}));

    const authHeader = req.headers.get("authorization") ?? "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
    const apiKey = req.headers.get("apikey") || "";
    const isCron = body.cron === true;
    const defaultMaxPosts = isCron ? 10 : 25;
    const defaultMaxComments = isCron ? 50 : 50;
    const requestedMaxPosts = Number(body.max_posts ?? defaultMaxPosts);
    const requestedMaxComments = Number(body.max_comments_per_post ?? defaultMaxComments);
    const maxPosts = Math.min(Math.max(Number.isFinite(requestedMaxPosts) ? requestedMaxPosts : defaultMaxPosts, 1), 100);
    const maxComments = Math.min(Math.max(Number.isFinite(requestedMaxComments) ? requestedMaxComments : defaultMaxComments, 1), isCron ? 50 : 100);
    const requestedScanPostLimit = Number(body.scan_post_limit ?? (isCron ? 300 : maxPosts));
    const requestedPostOffset = Number(body.post_offset);
    const scanPostLimit = Math.min(Math.max(Number.isFinite(requestedScanPostLimit) ? requestedScanPostLimit : maxPosts, maxPosts), 500);
    const postOffset = Number.isFinite(requestedPostOffset) ? Math.max(0, Math.floor(requestedPostOffset)) : null;
    const requestedCommentPageLimit = Number(body.comment_page_limit ?? (isCron ? 3 : 5));
    const commentPageLimit = Math.min(Math.max(Number.isFinite(requestedCommentPageLimit) ? requestedCommentPageLimit : 1, 1), 10);
    const debugSearch = typeof body.debug_search === "string" ? body.debug_search.trim().toLowerCase() : "";
    const debugOnly = body.debug_only === true;
    const debugMedia = body.debug_media === true;

    let connections: any[] = [];

    if (isCron) {
      if (!allowedCronKeys.includes(apiKey) && !allowedCronKeys.includes(bearer)) {
        return json({ error: "Unauthorized" }, 401);
      }
      const { data, error } = await admin
        .from("instagram_connections")
        .select("*")
        .eq("status", "connected")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      connections = data || [];
    } else {
      if (!authHeader.toLowerCase().startsWith("bearer ")) return json({ error: "Unauthorized" }, 401);
      const { data: { user }, error: userErr } = await admin.auth.getUser(bearer);
      if (userErr || !user) return json({ error: "Unauthorized" }, 401);

      const { data, error } = await admin
        .from("instagram_connections")
        .select("*")
        .eq("user_id", user.id)
        .eq("status", "connected")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      connections = data || [];
    }

    if (connections.length === 0) {
      return json({ ok: true, message: "Nenhuma conta Instagram conectada", scanned: 0, matched: 0, processed: 0 });
    }

    const perConnection = [];
    for (const connection of connections) {
      perConnection.push(await processConnection(admin, connection, maxPosts, maxComments, { isCron, scanPostLimit, postOffset, commentPageLimit, debugSearch, debugOnly, debugMedia }));
    }

    return json({
      ok: true,
      connections: perConnection.length,
      scanned: perConnection.reduce((sum, item) => sum + item.scanned, 0),
      matched: perConnection.reduce((sum, item) => sum + item.matched, 0),
      skipped_already_processed: perConnection.reduce((sum, item) => sum + item.skippedAlreadyProcessed, 0),
      skipped_already_replied: perConnection.reduce((sum, item) => sum + item.skippedAlreadyReplied, 0),
      posts_checked: perConnection.reduce((sum, item) => sum + item.postsChecked, 0),
      results: perConnection.flatMap((item) => item.results),
      debug_matches: perConnection.flatMap((item) => item.debugMatches || []),
      debug_media: perConnection.flatMap((item) => item.debugMedia || []),
    });
  } catch (error) {
    console.error("instagram-auto-reply-comments error:", error);
    return json({ error: (error as Error).message || "Erro interno" }, 500);
  }
});

async function processConnection(admin: any, connection: any, maxPosts: number, maxComments: number, options: { isCron?: boolean; scanPostLimit?: number; postOffset?: number | null; commentPageLimit?: number; debugSearch?: string; debugOnly?: boolean; debugMedia?: boolean } = {}) {
  let pageToken = connection.access_token;
  if (connection.page_id) {
    try {
      const r = await fetch(`${GRAPH}/${connection.page_id}?fields=access_token&access_token=${connection.access_token}`);
      const d = await r.json();
      if (r.ok && d.access_token) pageToken = d.access_token;
    } catch { /* keep original token */ }
  }

  const conn = { ...connection, access_token: pageToken };
  await ensureWebhookSubscriptions(conn);
  const ownUsername = (connection.instagram_username || "").toLowerCase();
  const now = Date.now();
  const recentCommentWindowMs = 24 * 60 * 60 * 1000;

  const { data: automations, error: automationError } = await admin
    .from("instagram_automations")
    .select("*, instagram_automation_steps(*)")
    .eq("user_id", connection.user_id)
    .eq("active", true)
    .in("trigger_type", ["any_comment", "comment_keyword"]);
  if (automationError) throw automationError;

  if (!automations || automations.length === 0) {
    return emptyConnectionResult(connection, "Nenhuma automação ativa");
  }

  const mediaLimit = Math.max(maxPosts, options.scanPostLimit || maxPosts);
  const mediaData = await fetchMediaWithPaging(connection.instagram_user_id, [pageToken, connection.access_token], mediaLimit);
  if (!mediaData.ok) {
    return { ...emptyConnectionResult(connection, mediaData.error || "Erro ao listar posts"), error: mediaData.error };
  }

  const allMediaList = mediaData.data?.data || [];
  const resolvedOffset = options.postOffset ?? (options.isCron ? getCronPostOffset(connection.id, allMediaList.length, maxPosts) : 0);
  const mediaWindow = allMediaList.slice(resolvedOffset, resolvedOffset + maxPosts);
  const topCommentedMedia = allMediaList
    .filter((media: any) => Number(media.comments_count || 0) > 0)
    .sort((a: any, b: any) => Number(b.comments_count || 0) - Number(a.comments_count || 0))
    .slice(0, maxPosts);
  const mediaList = uniqueById([...mediaWindow, ...topCommentedMedia]).slice(0, Math.min(maxPosts * 2, 100));
  let totalScanned = 0;
  let totalMatched = 0;
  let totalSkippedAlreadyReplied = 0;
  let totalSkippedAlreadyProcessed = 0;
  const results: any[] = [];
  const debugMatches: any[] = [];

  const commentsByMedia = await fetchCommentsForMedia(mediaList, pageToken, connection.access_token, maxComments, options.commentPageLimit || 1);

  for (const media of mediaList) {
    const commentsData = commentsByMedia.get(media.id) || { ok: false, error: "Comentários não retornados" };
    if (!commentsData.ok) {
      results.push({ media_id: media.id, ok: false, error: commentsData.error || "Erro ao listar comentários" });
      continue;
    }

    for (const parentComment of commentsData.data?.data || []) {
      const commentCandidates = [parentComment, ...(parentComment.replies?.data || [])];
      if (Number(parentComment.replies_count || 0) > (parentComment.replies?.data?.length || 0)) {
        const extraReplies = await fetchRepliesForComment(parentComment.id, [pageToken, connection.access_token], maxComments, options.commentPageLimit || 1);
        commentCandidates.push(...extraReplies);
      }
      for (const c of commentCandidates) {
      totalScanned++;
      const text = (c.text || "").trim();
      if (!c.id || !text) continue;
      const lower = text.toLowerCase();
      const username = c.username || c.user?.username || "amigo(a)";
      if (options.debugSearch && (`${lower} ${String(username).toLowerCase()}`).includes(options.debugSearch)) {
        debugMatches.push({ media_id: media.id, comment_id: c.id, username, text, timestamp: c.timestamp });
      }
      const commentTime = c.timestamp ? Date.parse(c.timestamp) : NaN;
      if (Number.isFinite(commentTime) && now - commentTime > recentCommentWindowMs) continue;
      if ((c.username || "").toLowerCase() === ownUsername) continue;

      const replies = c.replies?.data || [];
      const alreadyReplied = replies.some((r: any) => (r.username || "").toLowerCase() === ownUsername);
      if (alreadyReplied) {
        totalSkippedAlreadyReplied++;
        continue;
      }

      if (options.debugOnly) continue;

      for (const automation of automations) {
        if (!automationMatches(automation, lower)) continue;

        const { data: existingRun } = await admin
          .from("instagram_comment_automation_runs")
          .select("id")
          .eq("user_id", connection.user_id)
          .eq("comment_id", c.id)
          .eq("automation_id", automation.id)
          .maybeSingle();

        if (existingRun) {
          totalSkippedAlreadyProcessed++;
          continue;
        }

        const stepState = { privateReplySent: false };

        // Auto-like the comment (Graph API) — best effort
        const likeResult = await likeComment(conn, c.id);

        const stepsResult = await runSteps(automation.instagram_automation_steps || [], conn, {
          username,
          text,
          commentId: c.id,
          senderId: c.user?.id,
        }, stepState, { skipDelays: true });
        stepsResult.unshift({ type: "like_comment", ok: likeResult.ok, response: likeResult.data });

        const failed = stepsResult.find((step: any) => step.ok === false && step.type !== "like_comment");
        await admin.from("instagram_comment_automation_runs").upsert({
          user_id: connection.user_id,
          connection_id: connection.id,
          automation_id: automation.id,
          comment_id: c.id,
          media_id: media.id,
          commenter_id: c.user?.id || null,
          commenter_username: username,
          comment_text: text,
          status: failed ? "failed" : "processed",
          step_results: stepsResult,
          error: failed ? JSON.stringify(failed.response || failed.error || failed).slice(0, 1000) : null,
          processed_at: new Date().toISOString(),
        }, { onConflict: "user_id,comment_id,automation_id" });

        totalMatched++;
        results.push({
          connection: connection.instagram_username,
          media_id: media.id,
          comment_id: c.id,
          username,
          automation: automation.name,
          steps: stepsResult,
        });
        break;
      }
      }
    }
  }

  return {
    connection_id: connection.id,
    username: connection.instagram_username,
    scanned: totalScanned,
    matched: totalMatched,
    skippedAlreadyProcessed: totalSkippedAlreadyProcessed,
    skippedAlreadyReplied: totalSkippedAlreadyReplied,
    postsChecked: mediaList.length,
    results,
    debugMatches,
    debugMedia: options.debugMedia ? mediaList.map((media: any) => ({ id: media.id, caption: media.caption, timestamp: media.timestamp, comments_count: media.comments_count })) : [],
  };
}

function emptyConnectionResult(connection: any, message: string) {
  return {
    connection_id: connection.id,
    username: connection.instagram_username,
    scanned: 0,
    matched: 0,
    skippedAlreadyProcessed: 0,
    skippedAlreadyReplied: 0,
    postsChecked: 0,
    results: [{ connection: connection.instagram_username, message }],
  };
}

function automationMatches(automation: any, lowerText: string) {
  if (automation.trigger_type === "any_comment") return true;
  if (automation.trigger_type === "comment_keyword") {
    const keywords: string[] = automation.keywords || [];
    return keywords.some((kw) => lowerText.includes(String(kw).toLowerCase().trim()));
  }
  return false;
}

function getCronPostOffset(connectionId: string, totalPosts: number, windowSize: number) {
  if (totalPosts <= windowSize) return 0;
  const windows = Math.max(1, Math.ceil(totalPosts / windowSize));
  const minuteBucket = Math.floor(Date.now() / 60000);
  const seed = String(connectionId || "").split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return ((minuteBucket + seed) % windows) * windowSize;
}

function uniqueById(items: any[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = String(item?.id || "");
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

async function fetchGraphWithFallback(urlWithoutToken: string, tokens: string[]) {
  const uniqueTokens = [...new Set(tokens.filter(Boolean))];
  let lastError = "";
  for (const token of uniqueTokens) {
    try {
      const res = await fetch(`${urlWithoutToken}&access_token=${encodeURIComponent(token)}`);
      const data = await res.json();
      if (res.ok) return { ok: true, data };
      lastError = data?.error?.message || JSON.stringify(data);
    } catch (e) {
      lastError = (e as Error).message;
    }
  }
  return { ok: false, error: lastError };
}

async function fetchMediaWithPaging(igUserId: string, tokens: string[], limit: number) {
  const uniqueTokens = [...new Set(tokens.filter(Boolean))];
  let lastError = "";
  for (const token of uniqueTokens) {
    try {
      const data: any[] = [];
      let nextUrl: string | null = `${GRAPH}/${igUserId}/media?fields=id,caption,timestamp,comments_count&limit=${Math.min(limit, 100)}&access_token=${encodeURIComponent(token)}`;
      while (nextUrl && data.length < limit) {
        const res = await fetch(nextUrl);
        const page = await res.json();
        if (!res.ok) {
          lastError = page?.error?.message || JSON.stringify(page);
          break;
        }
        data.push(...(page.data || []));
        nextUrl = page.paging?.next || null;
      }
      if (data.length > 0 || !lastError) return { ok: true, data: { data: data.slice(0, limit) } };
    } catch (e) {
      lastError = (e as Error).message;
    }
  }
  return { ok: false, error: lastError };
}

async function fetchCommentsForMedia(mediaList: any[], pageToken: string, fallbackToken: string, maxComments: number, pageLimit = 1) {
  const results = new Map<string, any>();
  const tokens = [...new Set([pageToken, fallbackToken].filter(Boolean))];
  const fields = `comments.order(reverse_chronological).limit(${maxComments}){id,text,username,timestamp,user{id,username},replies_count,replies.limit(${maxComments}){id,username,text,timestamp,user{id,username}}}`;

  for (let i = 0; i < mediaList.length; i += 10) {
    const chunk = mediaList.slice(i, i + 10);
    const ids = chunk.map((media) => media.id).filter(Boolean).join(",");
    if (!ids) continue;

    let chunkOk = false;
    let lastError = "";
    for (const token of tokens) {
      try {
        const res = await fetch(`${GRAPH}/?ids=${encodeURIComponent(ids)}&fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`);
        const data = await res.json();
        if (!res.ok) {
          lastError = data?.error?.message || JSON.stringify(data);
          continue;
        }
        for (const media of chunk) {
          const firstPage = data?.[media.id]?.comments || { data: [] };
          const comments = [...(firstPage.data || [])];
          let nextUrl = firstPage.paging?.next || null;
          for (let page = 1; nextUrl && page < pageLimit; page++) {
            const nextRes = await fetch(nextUrl);
            const nextData = await nextRes.json();
            if (!nextRes.ok) break;
            comments.push(...(nextData.data || []));
            nextUrl = nextData.paging?.next || null;
          }
          results.set(media.id, { ok: true, data: { data: comments } });
        }
        chunkOk = true;
        break;
      } catch (e) {
        lastError = (e as Error).message;
      }
    }

    if (!chunkOk) {
      for (const media of chunk) results.set(media.id, { ok: false, error: lastError || "Erro ao listar comentários" });
    }
  }

  return results;
}

async function fetchRepliesForComment(commentId: string, tokens: string[], maxReplies: number, pageLimit = 1) {
  const replies: any[] = [];
  for (const token of [...new Set(tokens.filter(Boolean))]) {
    try {
      let nextUrl: string | null = `${GRAPH}/${commentId}/replies?fields=id,username,text,timestamp,user{id,username}&limit=${maxReplies}&access_token=${encodeURIComponent(token)}`;
      for (let page = 0; nextUrl && page < pageLimit; page++) {
        const res = await fetch(nextUrl);
        const data = await res.json();
        if (!res.ok) break;
        replies.push(...(data.data || []));
        nextUrl = data.paging?.next || null;
      }
      if (replies.length > 0) break;
    } catch { /* try next token */ }
  }
  return replies;
}

async function ensureWebhookSubscriptions(conn: any) {
  try {
    if (conn.page_id) {
      await fetch(`${GRAPH}/${conn.page_id}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,feed&access_token=${encodeURIComponent(conn.access_token)}`, {
        method: "POST",
      });
    }
    if (conn.instagram_user_id) {
      const tokens = [conn.user_access_token, conn.access_token].filter(Boolean);
      for (const token of tokens) {
        const res = await fetch(`${GRAPH}/${conn.instagram_user_id}/subscribed_apps?subscribed_fields=comments,messages,mentions&access_token=${encodeURIComponent(token)}`, {
          method: "POST",
        });
        if (res.ok) break;
      }
    }
  } catch (e) {
    console.log("ensureWebhookSubscriptions failed:", (e as Error).message);
  }
}

function renderMessage(raw: string, ctx: { username: string; text: string }) {
  const variants = (raw || "").split("|||").map((s) => s.trim()).filter(Boolean);
  const picked = variants.length > 0 ? variants[Math.floor(Math.random() * variants.length)] : "";
  return picked
    .replace(/\{\{nome\}\}/gi, ctx.username)
    .replace(/\{nome\}/gi, ctx.username)
    .replace(/\{\{comentario\}\}/gi, ctx.text)
    .replace(/\{comentario\}/gi, ctx.text);
}

async function sendDM(conn: any, ctx: any, step: any, message: string, state?: { privateReplySent?: boolean }) {
  const dmType = step.dm_type || "text";
  const buttons: any[] = Array.isArray(step.buttons) ? step.buttons : [];

  if (ctx.commentId) {
    if (state?.privateReplySent) {
      return { type: "send_dm_private_reply", ok: true, skipped: true, reason: "private_reply_already_sent_for_comment" };
    }

    let finalMessage = message;
    if (dmType === "link" && step.link_url) {
      finalMessage = `${message}\n\n👉 ${step.link_url}`;
    } else if (dmType === "buttons" && buttons.length > 0) {
      const urlBtns = buttons.filter((b) => (b.action || "url") === "url" && b.url);
      if (urlBtns.length > 0) {
        finalMessage = `${message}\n\n${urlBtns.map((b: any) => `👉 ${b.title}: ${b.url}`).join("\n")}`;
      }
    }

    const r = await sendPrivateReply(conn, ctx.commentId, finalMessage);
    if (r.ok && state) state.privateReplySent = true;
    return { type: "send_dm_private_reply", ok: r.ok, message: finalMessage, response: r.data };
  }

  const useMessenger = (dmType === "buttons" || dmType === "link") && ctx.senderId;

  if (useMessenger) {
    let payload: any;
    if (dmType === "link") {
      const url = step.link_url || "";
      const title = step.link_title || "Acessar";
      payload = {
        recipient: { id: ctx.senderId },
        message: {
          attachment: {
            type: "template",
            payload: {
              template_type: "button",
              text: message || title,
              buttons: [{ type: "web_url", url, title: title.slice(0, 20) }],
            },
          },
        },
      };
    } else {
      // buttons: cada botão pode ser URL (web_url) ou Resposta (postback)
      const btns = buttons.slice(0, 3).map((b: any) => {
        const action = b.action || "url";
        if (action === "url" && b.url) {
          return {
            type: "web_url",
            url: b.url,
            title: String(b.title || "Acessar").slice(0, 20),
          };
        }
        // postback — o payload BTN|<stepId>|<buttonId> é decodificado pelo webhook
        return {
          type: "postback",
          title: String(b.title || "Opção").slice(0, 20),
          payload: `BTN|${step.id}|${b.id || Math.random().toString(36).slice(2, 8)}`,
        };
      });
      payload = {
        recipient: { id: ctx.senderId },
        message: {
          attachment: {
            type: "template",
            payload: { template_type: "button", text: message || "Escolha:", buttons: btns },
          },
        },
      };
    }
    const r = await fetch(`${GRAPH}/me/messages?access_token=${conn.access_token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const d = await r.json();
    return { type: `send_dm_${dmType}`, ok: r.ok, response: d };
  }

  // Texto puro (ou fallback): tenta private_replies se vier de comentário, senão /me/messages
  let finalMessage = message;
  if (dmType === "link" && step.link_url) {
    finalMessage = `${message}\n\n👉 ${step.link_url}`;
  } else if (dmType === "buttons" && buttons.length > 0) {
    // Como private_replies não suporta botões, anexa as URLs ao texto
    const urlBtns = buttons.filter((b) => (b.action || "url") === "url" && b.url);
    if (urlBtns.length > 0) {
      finalMessage = `${message}\n\n${urlBtns.map((b: any) => `👉 ${b.title}: ${b.url}`).join("\n")}`;
    }
  }

  if (ctx.senderId) {
    const r = await fetch(`${GRAPH}/me/messages?access_token=${conn.access_token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: { id: ctx.senderId }, message: { text: finalMessage } }),
    });
    const d = await r.json();
    return { type: "send_dm", ok: r.ok, message: finalMessage, response: d };
  }
  return { type: "send_dm", ok: false, error: "no commentId or senderId" };
}

async function runSteps(
  steps: any[],
  conn: any,
  ctx: { username: string; text: string; commentId?: string; senderId?: string },
  state: { privateReplySent?: boolean } = {},
  options: { skipDelays?: boolean } = {}
) {
  const sorted = (steps || []).sort((a: any, b: any) => a.step_order - b.step_order);
  const results: any[] = [];

  for (const step of sorted) {
    const message = renderMessage(step.message || "", ctx);

    if (step.step_type === "delay") {
      const sec = step.delay_seconds || 5;
      if (!options.skipDelays) await new Promise((r) => setTimeout(r, sec * 1000));
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
      const r = await sendDM(conn, ctx, step, message, state);
      results.push(r);
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

async function sendPrivateReply(conn: any, commentId: string, message: string) {
  try {
    const res = await fetch(`${GRAPH}/${commentId}/private_replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        access_token: conn.access_token,
      }),
    });
    const data = await res.json();
    if (res.ok || !conn.page_id) return { ok: res.ok, data };

    const fallback = await fetch(`${GRAPH}/${conn.page_id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { comment_id: commentId },
        message: { text: message },
        access_token: conn.access_token,
      }),
    });
    const fallbackData = await fallback.json();
    return { ok: fallback.ok, data: fallbackData };
  } catch (e) {
    return { ok: false, data: { error: (e as Error).message } };
  }
}

async function likeComment(conn: any, commentId: string) {
  try {
    const res = await fetch(`${GRAPH}/${commentId}/likes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_token: conn.access_token }),
    });
    const data = await res.json();
    return { ok: res.ok, data };
  } catch (e) {
    return { ok: false, data: { error: (e as Error).message } };
  }
}
