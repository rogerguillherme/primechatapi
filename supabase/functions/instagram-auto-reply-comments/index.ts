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

    const body = await req.json().catch(() => ({}));
    const MAX_POSTS = Math.min(Math.max(body.max_posts ?? 10, 1), 25);
    const MAX_COMMENTS = Math.min(Math.max(body.max_comments_per_post ?? 25, 1), 50);

    const { data: connection } = await admin
      .from("instagram_connections")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "connected")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!connection) return json({ error: "Nenhuma conta Instagram conectada" }, 404);

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

    const { data: automations } = await admin
      .from("instagram_automations")
      .select("*, instagram_automation_steps(*)")
      .eq("user_id", user.id)
      .eq("active", true)
      .in("trigger_type", ["any_comment", "comment_keyword"]);

    if (!automations || automations.length === 0) {
      return json({ ok: true, message: "Nenhuma automação ativa", processed: 0 });
    }

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
      const cUrl = `${GRAPH}/${media.id}/comments?fields=id,text,username,timestamp,user{id,username},replies{id,username,text}&limit=${MAX_COMMENTS}&access_token=${pageToken}`;
      const cr = await fetch(cUrl);
      const cd = await cr.json();
      if (!cr.ok) continue;
      const comments = cd.data || [];

      for (const c of comments) {
        totalScanned++;
        const replies = c.replies?.data || [];
        const alreadyReplied = replies.some((r: any) => (r.username || "").toLowerCase() === ownUsername);
        if (alreadyReplied) {
          totalSkippedAlreadyReplied++;
          continue;
        }
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
          break;
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

function renderMessage(raw: string, ctx: { username: string; text: string }) {
  const variants = (raw || "").split("|||").map((s) => s.trim()).filter(Boolean);
  const picked = variants.length > 0 ? variants[Math.floor(Math.random() * variants.length)] : "";
  return picked
    .replace(/\{\{nome\}\}/gi, ctx.username)
    .replace(/\{nome\}/gi, ctx.username)
    .replace(/\{\{comentario\}\}/gi, ctx.text)
    .replace(/\{comentario\}/gi, ctx.text);
}

async function sendDM(conn: any, ctx: any, step: any, message: string) {
  const dmType = step.dm_type || "text";
  const buttons: any[] = Array.isArray(step.buttons) ? step.buttons : [];

  // Para botões/link, usamos /me/messages (template button). private_replies só aceita texto.
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

  if (ctx.commentId) {
    const r = await fetch(`${GRAPH}/${ctx.commentId}/private_replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: finalMessage, access_token: conn.access_token }),
    });
    const d = await r.json();
    return { type: "send_dm_private_reply", ok: r.ok, message: finalMessage, response: d };
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
  ctx: { username: string; text: string; commentId?: string; senderId?: string }
) {
  const sorted = (steps || []).sort((a: any, b: any) => a.step_order - b.step_order);
  const results: any[] = [];

  for (const step of sorted) {
    const message = renderMessage(step.message || "", ctx);

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
      const r = await sendDM(conn, ctx, step, message);
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
