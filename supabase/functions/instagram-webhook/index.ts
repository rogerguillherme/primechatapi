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
  const verifyToken =
    Deno.env.get("INSTAGRAM_VERIFY_TOKEN") ||
    Deno.env.get("WHATSAPP_VERIFY_TOKEN") ||
    "primechat_ig_2024";

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
      const isReprocess = req.headers.get("x-reprocess-event-id");

      for (const entry of body.entry || []) {
        // Determinar event_type para o log
        let eventType = "unknown";
        if (entry.changes?.some((c: any) => c.field === "comments")) eventType = "comment";
        else if (entry.changes?.some((c: any) => c.field === "messages")) eventType = "message";
        else if (entry.messaging?.some((m: any) => m.postback)) eventType = "postback";
        else if (entry.messaging?.length) eventType = "message";

        // Log event before processing (skip if this is a reprocess to avoid duplication)
        let eventLogId: string | null = null;
        if (!isReprocess) {
          const { data: logged } = await adminClient
            .from("instagram_webhook_events")
            .insert({
              entry_id: String(entry.id || ""),
              event_type: eventType,
              payload: { entry, object: body.object },
              processed: false,
              attempts: 1,
            })
            .select("id")
            .single();
          eventLogId = logged?.id || null;
        } else {
          eventLogId = isReprocess;
        }

        try {
        const entryId = String(entry.id || "");
        const candidateIds = new Set<string>([
          entryId,
          String(entry?.messaging?.[0]?.recipient?.id || ""),
          String(entry?.changes?.[0]?.value?.page_id || ""),
          String(entry?.changes?.[0]?.value?.recipient?.id || ""),
        ]);

        // Find connection: comments come with entry.id = instagram_user_id, DMs come with page_id
        // IMPORTANT: do NOT filter by status='connected' — Meta keeps delivering webhooks even
        // when our DB flag is stale; missing these means lost automations.
        const ids = Array.from(candidateIds).filter(Boolean);
        console.log(`IG webhook entry.id=${entryId} candidates=${ids.join(",")}`);

        const { data: connectionsAll } = await adminClient
          .from("instagram_connections")
          .select("id, user_id, access_token, instagram_user_id, page_id, instagram_username, status")
          .or(`page_id.in.(${ids.join(",")}),instagram_user_id.in.(${ids.join(",")})`)
          .order("status", { ascending: true }) // 'connected' before 'disconnected'
          .order("updated_at", { ascending: false });

        // Tenant isolation: keep at most one connection per user_id (prefer connected/most recent),
        // and process each tenant independently. If two tenants linked the same IG/Page,
        // both legitimately receive their OWN copy of the event (their own automations, DMs, logs).
        const byTenant = new Map<string, any>();
        for (const c of connectionsAll || []) {
          if (!byTenant.has(c.user_id)) byTenant.set(c.user_id, c);
        }
        const tenantConns = Array.from(byTenant.values());

        if (!tenantConns.length) {
          console.log(`No connection found for IG webhook. candidates=${ids.join(",")} — check if account was ever linked.`);
          if (eventLogId) {
            await adminClient.from("instagram_webhook_events").update({
              processed: true,
              processed_at: new Date().toISOString(),
              error: `No connection found (candidates=${ids.join(",")})`,
            }).eq("id", eventLogId);
          }
          continue;
        }

        if (tenantConns.length > 1) {
          console.warn(`IG webhook matched ${tenantConns.length} tenants for candidates=${ids.join(",")} — fanning out (isolated per user_id).`);
        }

        let anyError: string | null = null;
        for (const conn of tenantConns) {
          try {
            console.log(`Matched connection @${conn.instagram_username} user=${conn.user_id} (status=${conn.status})`);

            // Enrich event log with connection info (best-effort; first tenant wins on the row)
            if (eventLogId && tenantConns.length === 1) {
              await adminClient.from("instagram_webhook_events").update({
                user_id: conn.user_id,
                connection_id: conn.id,
              }).eq("id", eventLogId);
            }

            const resolvedConn = await enrichConnectionForMessaging(conn);
            const agent = await getActiveAgent(adminClient, resolvedConn.user_id);

            for (const change of entry.changes || []) {
              if (change.field === "comments") {
                await handleComment(adminClient, resolvedConn, change.value, agent);
              }
              if (change.field === "messages" && change.value?.message?.text && change.value?.sender?.id !== resolvedConn.instagram_user_id) {
                await handleDM(adminClient, resolvedConn, change.value, agent);
              }
            }

            for (const msg of entry.messaging || []) {
              if (msg.postback?.payload && msg.sender?.id !== resolvedConn.instagram_user_id) {
                await handlePostback(adminClient, resolvedConn, msg);
                continue;
              }
              if (msg.message?.text && msg.sender?.id !== resolvedConn.instagram_user_id) {
                await handleDM(adminClient, resolvedConn, msg, agent);
              }
            }
          } catch (perTenantErr) {
            anyError = (perTenantErr as Error).message || String(perTenantErr);
            console.error(`Per-tenant processing failed for user=${conn.user_id}:`, perTenantErr);
          }
        }

        if (eventLogId) {
          await adminClient.from("instagram_webhook_events").update({
            processed: !anyError,
            processed_at: new Date().toISOString(),
            error: anyError,
          }).eq("id", eventLogId);
        }
        } catch (entryErr) {
          console.error("Entry processing error:", entryErr);
          if (eventLogId) {
            await adminClient.from("instagram_webhook_events").update({
              processed: false,
              error: (entryErr as Error).message || String(entryErr),
            }).eq("id", eventLogId);
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
  let privateReplySent = false;
  for (const step of sorted) {
    // Suporte a múltiplas variantes separadas por "|||" — escolhe uma aleatória
    const rawMessage = step.message || "";
    const variants = rawMessage.split("|||").map((s: string) => s.trim()).filter(Boolean);
    const picked = variants.length > 0 ? variants[Math.floor(Math.random() * variants.length)] : "";
    const message = picked
      .replace(/\{\{nome\}\}/gi, ctx.username)
      .replace(/\{nome\}/gi, ctx.username)
      .replace(/\{\{comentario\}\}/gi, ctx.text)
      .replace(/\{comentario\}/gi, ctx.text);

    if (step.step_type === "delay") {
      await new Promise((r) => setTimeout(r, (step.delay_seconds || 5) * 1000));
    } else if (step.step_type === "reply_comment" && ctx.commentId) {
      await replyToComment(conn.access_token, ctx.commentId, message);
    } else if (step.step_type === "send_dm") {
      if (ctx.commentId && privateReplySent) {
        console.log("Skipping extra private reply for comment — Instagram allows one initial DM per comment");
        continue;
      }
      const sentPrivateReply = await sendRichDM(conn, ctx, step, message);
      if (ctx.commentId && sentPrivateReply) privateReplySent = true;
    }
  }
}

// Envio de DM com suporte a botões (URL/postback) e link
async function sendRichDM(conn: any, ctx: { commentId?: string; senderId?: string }, step: any, message: string): Promise<boolean> {
  const dmType = step.dm_type || "text";
  const buttons: any[] = Array.isArray(step.buttons) ? step.buttons : [];
  if (ctx.commentId) {
    let finalMessage = message;
    if (dmType === "link" && step.link_url) {
      finalMessage = `${message}\n\n👉 ${step.link_url}`;
    } else if (dmType === "buttons" && buttons.length > 0) {
      const urlBtns = buttons.filter((b: any) => (b.action || "url") === "url" && b.url);
      if (urlBtns.length > 0) {
        finalMessage = `${message}\n\n${urlBtns.map((b: any) => `👉 ${b.title}: ${b.url}`).join("\n")}`;
      }
    }
    await sendPrivateReplyToComment(conn, ctx.commentId, finalMessage);
    return true;
  }

  const useTemplate = (dmType === "buttons" || dmType === "link") && ctx.senderId && conn.page_id;

  if (useTemplate) {
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
        messaging_type: "RESPONSE",
        access_token: conn.access_token,
      };
    } else {
      const btns = buttons.slice(0, 3).map((b: any) => {
        const action = b.action || "url";
        if (action === "url" && b.url) {
          return { type: "web_url", url: b.url, title: String(b.title || "Acessar").slice(0, 20) };
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
        messaging_type: "RESPONSE",
        access_token: conn.access_token,
      };
    }
    try {
      const res = await fetch(`https://graph.facebook.com/v19.0/${conn.page_id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) console.error("Rich DM failed:", data);
      else console.log(`Rich DM (${dmType}) OK:`, data);
      return false;
    } catch (e) {
      console.error("Rich DM error:", e);
      return false;
    }
  }

  // Fallback texto: anexa URLs ao texto se houver
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
    await sendPrivateReplyToComment(conn, ctx.commentId, finalMessage);
    return true;
  } else if (ctx.senderId) {
    await sendInstagramDM(conn.access_token, conn.page_id, ctx.senderId, finalMessage);
  }
  return false;
}

async function handleComment(adminClient: any, conn: any, commentData: any, agent: any) {
  const { id: commentId, text, from } = commentData;
  if (!text || !from) return;
  const username = from.username || from.name || "amigo(a)";
  const lower = text.toLowerCase().trim();
  console.log(`Comment from @${username}: "${text}" (commentId=${commentId})`);

  // Avoid replying to our own comments (loop)
  if (conn.instagram_username && username.toLowerCase() === conn.instagram_username.toLowerCase()) {
    console.log("Skipping own comment to avoid loop");
    return;
  }

  let matched = false;
  const automations = await getAutomations(adminClient, conn.user_id, ["any_comment", "comment_keyword"]);
  console.log(`Loaded ${automations.length} comment automations for user ${conn.user_id}`);
  for (const automation of automations) {
    let trigger = false;
    if (automation.trigger_type === "any_comment") trigger = true;
    else if (automation.trigger_type === "comment_keyword") {
      const kws: string[] = automation.keywords || [];
      trigger = kws.some((kw) => lower.includes(kw.toLowerCase().trim()));
    }
    if (!trigger) {
      console.log(`Automation "${automation.name}" did NOT match (trigger=${automation.trigger_type}, kws=${(automation.keywords || []).join(",")})`);
      continue;
    }
    matched = true;
    console.log(`✓ Automation "${automation.name}" triggered — running ${(automation.instagram_automation_steps || []).length} steps`);
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

async function handlePostback(adminClient: any, conn: any, msg: any) {
  const senderId = msg.sender?.id;
  const payload: string = msg.postback?.payload || "";
  const title: string = msg.postback?.title || "";
  if (!senderId || !payload) return;

  console.log(`Postback from ${senderId}: payload="${payload}" title="${title}"`);

  // Espera-se formato: BTN|<stepId>|<buttonId>
  const parts = payload.split("|");
  if (parts[0] !== "BTN" || parts.length < 3) {
    console.log("Postback ignored — not a button payload");
    return;
  }
  const stepId = parts[1];
  const buttonId = parts[2];

  // Persistir o clique como mensagem inbound (mostra "Clicou: <título>" no chat)
  await persistInboundDM(adminClient, conn, senderId, msg.postback?.mid || null, `🔘 Clicou: ${title || buttonId}`);

  // Busca o step e o botão configurado
  const { data: step } = await adminClient
    .from("instagram_automation_steps")
    .select("id, automation_id, buttons, dm_type")
    .eq("id", stepId)
    .maybeSingle();

  if (!step) {
    console.log(`Postback step ${stepId} not found`);
    return;
  }

  const buttons: any[] = Array.isArray(step.buttons) ? step.buttons : [];
  const btn = buttons.find((b: any) => b.id === buttonId);
  if (!btn) {
    console.log(`Button ${buttonId} not found in step ${stepId}`);
    return;
  }

  const action = btn.action || "url";
  if (action === "url") {
    // Botão de URL: nada a fazer no webhook (Meta abriu o link no app do lead)
    console.log(`Button ${buttonId} is URL — no server action`);
    return;
  }

  // action === "reply" — buscar username do remetente para variáveis
  let username = "amigo(a)";
  try {
    const pr = await fetch(
      `https://graph.facebook.com/v19.0/${senderId}?fields=name,username&access_token=${conn.access_token}`
    );
    const pd = await pr.json();
    if (pr.ok) username = pd.username || pd.name || username;
  } catch { /* ignore */ }

  const raw = btn.reply_message || "";
  const variants = raw.split("|||").map((s: string) => s.trim()).filter(Boolean);
  const picked = variants.length > 0 ? variants[Math.floor(Math.random() * variants.length)] : "";
  const reply = picked
    .replace(/\{\{nome\}\}/gi, username)
    .replace(/\{nome\}/gi, username);

  if (!reply) {
    console.log(`Button ${buttonId} has empty reply_message`);
    return;
  }

  console.log(`Sending reply for button "${btn.title}" → "${reply.substring(0, 80)}"`);
  await sendInstagramDM(conn.access_token, conn.page_id, senderId, reply);
}


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
      .eq("user_id", conn.user_id)
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
