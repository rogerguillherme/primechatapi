import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const verifyToken = Deno.env.get("WHATSAPP_VERIFY_TOKEN") || "instagram_verify_token";

  // GET = webhook verification from Meta
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

  // POST = webhook event from Meta
  if (req.method === "POST") {
    try {
      const body = await req.json();
      console.log("Instagram webhook received:", JSON.stringify(body).substring(0, 500));

      const adminClient = createClient(supabaseUrl, serviceRoleKey);

      // Process each entry
      for (const entry of body.entry || []) {
        // Handle comment changes
        for (const change of entry.changes || []) {
          if (change.field === "comments") {
            await handleComment(adminClient, entry.id, change.value);
          }
        }
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Instagram webhook error:", error);
      return new Response(JSON.stringify({ error: "Internal error" }), {
        status: 200, // Always return 200 to Meta to avoid retries
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  return new Response("Method not allowed", { status: 405 });
});

async function handleComment(adminClient: any, igPageId: string, commentData: any) {
  const { id: commentId, text, from, media } = commentData;
  if (!text || !from) return;

  const commenterUsername = from.username || from.name || "";
  const commentText = text.toLowerCase().trim();

  console.log(`Comment from @${commenterUsername}: "${text}" on page ${igPageId}`);

  // Find instagram connections linked to this page
  const { data: connections } = await adminClient
    .from("instagram_connections")
    .select("user_id, access_token, instagram_user_id, page_id")
    .eq("status", "connected");

  if (!connections?.length) return;

  for (const conn of connections) {
    // Get active automations for this user
    const { data: automations } = await adminClient
      .from("instagram_automations")
      .select("*, instagram_automation_steps(*)")
      .eq("user_id", conn.user_id)
      .eq("active", true);

    if (!automations?.length) continue;

    for (const automation of automations) {
      let shouldTrigger = false;

      if (automation.trigger_type === "any_comment") {
        shouldTrigger = true;
      } else if (automation.trigger_type === "comment_keyword") {
        const keywords: string[] = automation.keywords || [];
        shouldTrigger = keywords.some((kw: string) =>
          commentText.includes(kw.toLowerCase().trim())
        );
      }

      if (!shouldTrigger) continue;

      console.log(`Automation "${automation.name}" triggered for @${commenterUsername}`);

      // Sort steps by order
      const steps = (automation.instagram_automation_steps || []).sort(
        (a: any, b: any) => a.step_order - b.step_order
      );

      for (const step of steps) {
        const message = (step.message || "")
          .replace(/\{\{nome\}\}/g, commenterUsername)
          .replace(/\{\{comentario\}\}/g, text);

        if (step.step_type === "delay") {
          const delaySec = step.delay_seconds || 5;
          await new Promise((r) => setTimeout(r, delaySec * 1000));
        } else if (step.step_type === "reply_comment" && commentId) {
          await replyToComment(conn.access_token, commentId, message);
        } else if (step.step_type === "send_dm" && from.id) {
          await sendInstagramDM(conn.access_token, conn.instagram_user_id, from.id, message);
        }
      }
    }
  }
}

async function replyToComment(accessToken: string, commentId: string, message: string) {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${commentId}/replies`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          access_token: accessToken,
        }),
      }
    );
    const data = await res.json();
    if (!res.ok) {
      console.error("Reply to comment failed:", data);
    } else {
      console.log("Comment replied:", data.id);
    }
  } catch (e) {
    console.error("Error replying to comment:", e);
  }
}

async function sendInstagramDM(accessToken: string, igUserId: string, recipientId: string, message: string) {
  try {
    // Use Instagram Messaging API via the page
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${igUserId}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: { text: message },
          access_token: accessToken,
        }),
      }
    );
    const data = await res.json();
    if (!res.ok) {
      console.error("Send DM failed:", data);
    } else {
      console.log("DM sent:", data);
    }
  } catch (e) {
    console.error("Error sending DM:", e);
  }
}
