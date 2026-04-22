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
    const {
      comment_id,
      text,
      commenter_username,
      commenter_id,
    } = body as {
      comment_id?: string;
      text?: string;
      commenter_username?: string;
      commenter_id?: string;
    };

    if (!comment_id || !text) return json({ error: "comment_id e text obrigatórios" }, 400);

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

    // Resolve page token for sending DMs
    let pageToken = connection.access_token;
    if (connection.page_id) {
      try {
        const r = await fetch(`${GRAPH}/${connection.page_id}?fields=access_token&access_token=${connection.access_token}`);
        const d = await r.json();
        if (r.ok && d.access_token) pageToken = d.access_token;
      } catch { /* ignore */ }
    }
    const conn = { ...connection, access_token: pageToken };

    // Load active comment automations
    const { data: automations } = await admin
      .from("instagram_automations")
      .select("*, instagram_automation_steps(*)")
      .eq("user_id", user.id)
      .eq("active", true)
      .in("trigger_type", ["any_comment", "comment_keyword"]);

    const username = commenter_username || "amigo(a)";
    const lower = text.toLowerCase().trim();
    const log: any[] = [];
    let matchedCount = 0;

    for (const automation of automations || []) {
      let trigger = false;
      if (automation.trigger_type === "any_comment") trigger = true;
      else if (automation.trigger_type === "comment_keyword") {
        const kws: string[] = automation.keywords || [];
        trigger = kws.some((kw) => lower.includes(kw.toLowerCase().trim()));
      }
      if (!trigger) {
        log.push({ automation: automation.name, matched: false, reason: `keywords não encontradas em "${text}"` });
        continue;
      }
      matchedCount++;
      const stepsResult = await runSteps(automation.instagram_automation_steps || [], conn, {
        username,
        text,
        commentId: comment_id,
        senderId: commenter_id,
      });
      log.push({ automation: automation.name, matched: true, steps: stepsResult });
    }

    if (matchedCount === 0) {
      return json({
        ok: true,
        matched: false,
        message: "Nenhuma automação ativa correspondeu a este comentário",
        log,
      });
    }

    return json({ ok: true, matched: true, matched_count: matchedCount, log });
  } catch (error) {
    console.error("instagram-trigger-automation error:", error);
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
      const r = await replyToComment(conn.access_token, ctx.commentId, message);
      results.push({ type: "reply_comment", ok: r.ok, message, response: r.data });
    } else if (step.step_type === "send_dm") {
      const dmType = step.dm_type || "text";
      const buttons: any[] = Array.isArray(step.buttons) ? step.buttons : [];
      const useMessenger = (dmType === "buttons" || dmType === "link") && ctx.senderId;

      if (useMessenger) {
        let payload: any;
        if (dmType === "link") {
          const url = step.link_url || "";
          const title = (step.link_title || "Acessar").slice(0, 20);
          payload = {
            recipient: { id: ctx.senderId },
            message: {
              attachment: {
                type: "template",
                payload: {
                  template_type: "button",
                  text: message || title,
                  buttons: [{ type: "web_url", url, title }],
                },
              },
            },
          };
        } else {
          // buttons mistos: cada botão pode ser URL (web_url) ou Resposta (postback)
          const btns = buttons.slice(0, 3).map((b: any) => {
            const action = b.action || "url";
            if (action === "url" && b.url) {
              return {
                type: "web_url",
                url: b.url,
                title: String(b.title || "Acessar").slice(0, 20),
              };
            }
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
        try {
          const res = await fetch(`${GRAPH}/me/messages?access_token=${conn.access_token}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const data = await res.json();
          results.push({ type: `send_dm_${dmType}`, ok: res.ok, response: data });
        } catch (e) {
          results.push({ type: `send_dm_${dmType}`, ok: false, response: { error: (e as Error).message } });
        }
      } else {
        let finalMessage = message;
        if (dmType === "link" && step.link_url) {
          finalMessage = `${message}\n\n👉 ${step.link_url}`;
        } else if (dmType === "buttons" && buttons.length > 0) {
          const urlBtns = buttons.filter((b: any) => (b.action || "url") === "url" && b.url);
          if (urlBtns.length > 0) {
            finalMessage = `${message}\n\n${urlBtns.map((b: any) => `👉 ${b.title}: ${b.url}`).join("\n")}`;
          }
        }
        if (ctx.commentId) {
          const r = await sendPrivateReply(conn.access_token, ctx.commentId, finalMessage);
          results.push({ type: "send_dm_private_reply", ok: r.ok, message: finalMessage, response: r.data });
        } else if (ctx.senderId) {
          const r = await sendInstagramDM(conn.access_token, ctx.senderId, finalMessage);
          results.push({ type: "send_dm", ok: r.ok, message: finalMessage, response: r.data });
        }
      }
    }
  }
  return results;
}

async function replyToComment(accessToken: string, commentId: string, message: string) {
  try {
    const res = await fetch(`${GRAPH}/${commentId}/replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, access_token: accessToken }),
    });
    const data = await res.json();
    return { ok: res.ok, data };
  } catch (e) {
    return { ok: false, data: { error: (e as Error).message } };
  }
}

async function sendPrivateReply(accessToken: string, commentId: string, message: string) {
  try {
    const res = await fetch(`${GRAPH}/${commentId}/private_replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, access_token: accessToken }),
    });
    const data = await res.json();
    return { ok: res.ok, data };
  } catch (e) {
    return { ok: false, data: { error: (e as Error).message } };
  }
}

async function sendInstagramDM(accessToken: string, recipientId: string, message: string) {
  try {
    const res = await fetch(`${GRAPH}/me/messages?access_token=${accessToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text: message },
      }),
    });
    const data = await res.json();
    return { ok: res.ok, data };
  } catch (e) {
    return { ok: false, data: { error: (e as Error).message } };
  }
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
