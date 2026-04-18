import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const verifyToken = Deno.env.get("WHATSAPP_VERIFY_TOKEN") || "instagram_verify_token";

  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === verifyToken) {
      console.log("Instagram webhook verified");
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method === "POST") {
    try {
      const body = await req.json();
      console.log("IG webhook received:", JSON.stringify(body).substring(0, 800));

      const adminClient = createClient(supabaseUrl, serviceRoleKey);

      for (const entry of body.entry || []) {
        const entryId = String(entry.id);

        // Find connection for this page/IG account
        const { data: conn } = await adminClient
          .from("instagram_connections")
          .select("user_id, access_token, instagram_user_id, page_id, instagram_username")
          .eq("status", "connected")
          .or(`page_id.eq.${entryId},instagram_user_id.eq.${entryId}`)
          .maybeSingle();

        if (!conn) {
          console.log(`No connection for entry.id=${entryId}`);
          continue;
        }

        const resolvedConn = await enrichConnectionForMessaging(conn);

        // Load AI Agent (if active) once per entry
        const agent = await getActiveAgent(adminClient, resolvedConn.user_id);

        // Comments via changes[].field=comments
        for (const change of entry.changes || []) {
          if (change.field === "comments") {
            await handleComment(adminClient, resolvedConn, change.value, agent);
          }
        }

        // Direct messages via messaging[]
        for (const msg of entry.messaging || []) {
          if (msg.message?.text && msg.sender?.id !== resolvedConn.instagram_user_id) {
            await handleDM(adminClient, resolvedConn, msg, agent);
          }
        }
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("IG webhook error:", error);
      return new Response(JSON.stringify({ error: "Internal" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  return new Response("Method not allowed", { status: 405 });
});

async function getAutomations(adminClient: any, userId: string, triggerTypes: string[]) {
  const { data } = await adminClient
    .from("instagram_automations")
    .select("*, instagram_automation_steps(*)")
    .eq("user_id", userId)
    .eq("active", true)
    .in("trigger_type", triggerTypes);
  return data || [];
}

async function enrichConnectionForMessaging(conn: any) {
  if (!conn?.page_id || !conn?.access_token) return conn;

  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${conn.page_id}?fields=access_token&access_token=${conn.access_token}`
    );
    const data = await res.json();

    if (!res.ok) {
      console.error("Failed to resolve page access token:", data);
      return conn;
    }

    return {
      ...conn,
      access_token: data.access_token || conn.access_token,
    };
  } catch (error) {
    console.error("Failed to enrich Instagram connection:", error);
    return conn;
  }
}

async function runSteps(steps: any[], conn: any, ctx: { username: string; text: string; commentId?: string; senderId?: string }) {
  const sorted = (steps || []).sort((a: any, b: any) => a.step_order - b.step_order);
  for (const step of sorted) {
    const message = (step.message || "")
      .replace(/\{\{nome\}\}/gi, ctx.username)
      .replace(/\{nome\}/gi, ctx.username)
      .replace(/\{\{comentario\}\}/gi, ctx.text)
      .replace(/\{comentario\}/gi, ctx.text);

    if (step.step_type === "delay") {
      await new Promise((r) => setTimeout(r, (step.delay_seconds || 5) * 1000));
    } else if (step.step_type === "reply_comment" && ctx.commentId) {
      await replyToComment(conn.access_token, ctx.commentId, message);
    } else if (step.step_type === "send_dm" && ctx.senderId) {
      if (ctx.commentId) {
        await sendPrivateReplyToComment(conn.access_token, ctx.commentId, message);
      } else {
        await sendInstagramDM(conn.access_token, conn.page_id, ctx.senderId, message);
      }
    }
  }
}

async function handleComment(adminClient: any, conn: any, commentData: any, agent: any) {
  const { id: commentId, text, from } = commentData;
  if (!text || !from) return;
  const username = from.username || from.name || "amigo(a)";
  const lower = text.toLowerCase().trim();
  console.log(`Comment from @${username}: "${text}"`);

  let matched = false;
  const automations = await getAutomations(adminClient, conn.user_id, ["any_comment", "comment_keyword"]);
  for (const automation of automations) {
    let trigger = false;
    if (automation.trigger_type === "any_comment") trigger = true;
    else if (automation.trigger_type === "comment_keyword") {
      const kws: string[] = automation.keywords || [];
      trigger = kws.some((kw) => lower.includes(kw.toLowerCase().trim()));
    }
    if (!trigger) continue;
    matched = true;
    console.log(`Automation "${automation.name}" triggered`);
    await runSteps(automation.instagram_automation_steps, conn, {
      username, text, commentId, senderId: from.id,
    });
  }

  if (!matched && agent && agentChannelEnabled(agent, "replyComments")) {
    if (await canRespond(adminClient, agent)) {
      const reply = await generateAgentReply(agent, text, username, "comment");
      if (reply) {
        await replyToComment(conn.access_token, commentId, reply);
        await trackInteraction(adminClient, agent);
      }
    }
  }
}

async function handleDM(adminClient: any, conn: any, msg: any, agent: any) {
  const text = msg.message?.text || "";
  const senderId = msg.sender?.id;
  if (!text || !senderId) return;
  const lower = text.toLowerCase().trim();
  console.log(`DM from ${senderId}: "${text}"`);

  // Persist inbound message
  await persistInboundDM(adminClient, conn, senderId, msg.message?.mid || null, text);

  let matched = false;
  const automations = await getAutomations(adminClient, conn.user_id, ["any_dm", "dm_keyword"]);
  for (const automation of automations) {
    let trigger = false;
    if (automation.trigger_type === "any_dm") trigger = true;
    else if (automation.trigger_type === "dm_keyword") {
      const kws: string[] = automation.keywords || [];
      trigger = kws.some((kw) => lower.includes(kw.toLowerCase().trim()));
    }
    if (!trigger) continue;
    matched = true;
    await runSteps(automation.instagram_automation_steps, conn, {
      username: "amigo(a)", text, senderId,
    });
  }

  if (!matched && agent && agentChannelEnabled(agent, "replyDMs")) {
    if (await canRespond(adminClient, agent)) {
      const reply = await generateAgentReply(agent, text, "amigo(a)", "dm");
      if (reply) {
        await sendInstagramDM(conn.access_token, conn.page_id, senderId, reply);
        await trackInteraction(adminClient, agent);
      }
    }
  }
}

// ============= Persistence helpers =============

async function persistInboundDM(adminClient: any, conn: any, senderId: string, igMessageId: string | null, text: string) {
  try {
    let username: string | null = null;
    let avatar: string | null = null;
    try {
      const pr = await fetch(
        `https://graph.facebook.com/v19.0/${senderId}?fields=name,username,profile_pic&access_token=${conn.access_token}`
      );
      const pd = await pr.json();
      if (pr.ok) {
        username = pd.username || pd.name || null;
        avatar = pd.profile_pic || null;
      }
    } catch { /* ignore */ }

    let convId: string | null = null;
    const { data: existing } = await adminClient
      .from("instagram_conversations")
      .select("id, unread_count")
      .eq("ig_user_id", conn.instagram_user_id)
      .eq("participant_id", senderId)
      .maybeSingle();

    if (existing) {
      convId = existing.id;
      await adminClient
        .from("instagram_conversations")
        .update({
          last_message_text: text,
          last_message_at: new Date().toISOString(),
          unread_count: (existing.unread_count || 0) + 1,
          participant_username: username || undefined,
          participant_avatar_url: avatar || undefined,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
    } else {
      const { data: created } = await adminClient
        .from("instagram_conversations")
        .insert({
          user_id: conn.user_id,
          connection_id: conn.id,
          ig_user_id: conn.instagram_user_id,
          participant_id: senderId,
          participant_username: username,
          participant_name: username,
          participant_avatar_url: avatar,
          last_message_text: text,
          last_message_at: new Date().toISOString(),
          unread_count: 1,
        })
        .select("id")
        .single();
      convId = created?.id || null;
    }

    if (convId) {
      await adminClient.from("instagram_messages").insert({
        conversation_id: convId,
        user_id: conn.user_id,
        ig_message_id: igMessageId,
        direction: "inbound",
        text,
        status: "received",
      });
    }
  } catch (e) {
    console.error("persistInboundDM error:", e);
  }
}

// ============= AI Agent helpers =============

async function getActiveAgent(adminClient: any, userId: string) {
  const { data } = await adminClient
    .from("ai_agents")
    .select("*")
    .eq("user_id", userId)
    .eq("name", "Agente Instagram")
    .eq("active", true)
    .maybeSingle();
  return data;
}

function agentChannelEnabled(agent: any, key: "replyComments" | "replyDMs"): boolean {
  try {
    const cfg = agent.knowledge ? JSON.parse(agent.knowledge) : {};
    return cfg[key] !== false;
  } catch {
    return true;
  }
}

async function canRespond(adminClient: any, agent: any): Promise<boolean> {
  const limit = agent.max_interactions || 0;
  if (limit <= 0) return true;
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const { count } = await adminClient
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", agent.user_id)
    .eq("action", "ig_agent_reply")
    .gte("created_at", since.toISOString());
  if ((count || 0) >= limit) {
    console.log(`IG agent daily limit reached: ${count}/${limit}`);
    return false;
  }
  return true;
}

async function trackInteraction(adminClient: any, agent: any) {
  try {
    await adminClient.from("audit_logs").insert({
      user_id: agent.user_id,
      action: "ig_agent_reply",
      table_name: "ai_agents",
      record_id: agent.id,
    });
  } catch (e) {
    console.error("track error:", e);
  }
}

async function generateAgentReply(agent: any, userText: string, username: string, channel: "comment" | "dm"): Promise<string | null> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) {
    console.error("LOVABLE_API_KEY missing");
    return null;
  }

  const persona = agent.guidelines || "Você é um assistente simpático e profissional.";
  const rules = agent.instructions || "";
  const faqArr = Array.isArray(agent.faq) ? agent.faq : [];
  const faqText = faqArr.length
    ? "\n\nFAQ (priorize estas respostas quando aplicável):\n" +
      faqArr.map((f: any, i: number) => `${i + 1}. P: ${f.question}\n   R: ${f.answer}`).join("\n")
    : "";

  const channelHint = channel === "comment"
    ? "Responda como resposta a comentário público no Instagram. MÁXIMO 2 frases curtas, tom acolhedor."
    : "Responda como mensagem direta (DM) no Instagram. MÁXIMO 3 frases, tom próximo e prestativo.";

  const system = `${persona}\n\nRegras obrigatórias:\n${rules}\n\n${channelHint}${faqText}\n\nNUNCA mencione que é uma IA. Use o nome ${username} se fizer sentido.`;

  const model = agent.ai_model || "google/gemini-2.5-flash";

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userText },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`AI reply failed [${res.status}]:`, errText);
      return null;
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content?.trim();
    return content || null;
  } catch (e) {
    console.error("AI reply error:", e);
    return null;
  }
}

async function replyToComment(accessToken: string, commentId: string, message: string) {
  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${commentId}/replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, access_token: accessToken }),
    });
    const data = await res.json();
    if (!res.ok) console.error("Reply failed:", data);
    else console.log("Reply OK:", data.id);
  } catch (e) {
    console.error("Reply error:", e);
  }
}

async function sendPrivateReplyToComment(accessToken: string, commentId: string, message: string) {
  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${commentId}/private_replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        access_token: accessToken,
      }),
    });
    const data = await res.json();
    if (!res.ok) console.error("Private reply failed:", data);
    else console.log("Private reply OK:", data);
  } catch (e) {
    console.error("Private reply error:", e);
  }
}

async function sendInstagramDM(accessToken: string, pageId: string, recipientId: string, message: string) {
  if (!pageId) {
    console.error("DM failed: missing page_id on instagram connection");
    return;
  }

  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text: message },
        messaging_type: "RESPONSE",
        access_token: accessToken,
      }),
    });
    const data = await res.json();
    if (!res.ok) console.error("DM failed:", data);
    else console.log("DM OK:", data);
  } catch (e) {
    console.error("DM error:", e);
  }
}
