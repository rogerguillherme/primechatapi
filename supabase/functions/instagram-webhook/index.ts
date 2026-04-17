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
          .select("user_id, access_token, instagram_user_id, page_id")
          .eq("status", "connected")
          .or(`page_id.eq.${entryId},instagram_user_id.eq.${entryId}`)
          .maybeSingle();

        if (!conn) {
          console.log(`No connection for entry.id=${entryId}`);
          continue;
        }

        // Comments via changes[].field=comments
        for (const change of entry.changes || []) {
          if (change.field === "comments") {
            await handleComment(adminClient, conn, change.value);
          }
        }

        // Direct messages via messaging[]
        for (const msg of entry.messaging || []) {
          if (msg.message?.text && msg.sender?.id !== conn.instagram_user_id) {
            await handleDM(adminClient, conn, msg);
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
      await sendInstagramDM(conn.access_token, conn.instagram_user_id, ctx.senderId, message);
    }
  }
}

async function handleComment(adminClient: any, conn: any, commentData: any) {
  const { id: commentId, text, from } = commentData;
  if (!text || !from) return;
  const username = from.username || from.name || "amigo(a)";
  const lower = text.toLowerCase().trim();
  console.log(`Comment from @${username}: "${text}"`);

  const automations = await getAutomations(adminClient, conn.user_id, ["any_comment", "comment_keyword"]);
  for (const automation of automations) {
    let trigger = false;
    if (automation.trigger_type === "any_comment") trigger = true;
    else if (automation.trigger_type === "comment_keyword") {
      const kws: string[] = automation.keywords || [];
      trigger = kws.some((kw) => lower.includes(kw.toLowerCase().trim()));
    }
    if (!trigger) continue;
    console.log(`Automation "${automation.name}" triggered`);
    await runSteps(automation.instagram_automation_steps, conn, {
      username, text, commentId, senderId: from.id,
    });
  }
}

async function handleDM(adminClient: any, conn: any, msg: any) {
  const text = msg.message?.text || "";
  const senderId = msg.sender?.id;
  if (!text || !senderId) return;
  const lower = text.toLowerCase().trim();
  console.log(`DM from ${senderId}: "${text}"`);

  const automations = await getAutomations(adminClient, conn.user_id, ["any_dm", "dm_keyword"]);
  for (const automation of automations) {
    let trigger = false;
    if (automation.trigger_type === "any_dm") trigger = true;
    else if (automation.trigger_type === "dm_keyword") {
      const kws: string[] = automation.keywords || [];
      trigger = kws.some((kw) => lower.includes(kw.toLowerCase().trim()));
    }
    if (!trigger) continue;
    await runSteps(automation.instagram_automation_steps, conn, {
      username: "amigo(a)", text, senderId,
    });
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

async function sendInstagramDM(accessToken: string, igUserId: string, recipientId: string, message: string) {
  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${igUserId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text: message },
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
