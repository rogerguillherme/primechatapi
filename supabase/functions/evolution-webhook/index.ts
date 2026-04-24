// Webhook receiver for Evolution API (self-hosted)
// Configure on each instance: POST {SUPABASE_URL}/functions/v1/evolution-webhook?account_id={id}
// Subscribe events: messages.upsert, messages.update, connection.update

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const url = new URL(req.url);
    // Some Evolution servers append the event name to the URL path/query, dirtying account_id (e.g. "uuid/messages-upsert").
    // Sanitize: keep only the leading UUID portion.
    const rawAccountId = url.searchParams.get("account_id") || "";
    const uuidMatch = rawAccountId.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    const accountIdParam = uuidMatch ? uuidMatch[0] : "";

    const payload = await req.json().catch(() => ({}));
    console.log("Evolution webhook received:", JSON.stringify(payload).substring(0, 500));

    const event: string = payload.event || "";
    const instance: string = payload.instance || payload.instanceName || "";

    // Resolve account by id, then fall back to instance slug
    let account: any = null;
    if (accountIdParam) {
      const { data } = await supabase
        .from("whatsapp_accounts")
        .select("id, user_id, phone_number_id")
        .eq("provider", "evolution")
        .eq("id", accountIdParam)
        .maybeSingle();
      account = data;
    }
    if (!account && instance) {
      const { data } = await supabase
        .from("whatsapp_accounts")
        .select("id, user_id, phone_number_id")
        .eq("provider", "evolution")
        .eq("phone_number_id", instance)
        .maybeSingle();
      account = data;
    }

    if (!account) {
      console.log("No matching evolution account for instance:", instance, "param:", accountIdParam, "raw:", rawAccountId);
      return new Response(JSON.stringify({ ok: true, ignored: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ============= Incoming message =============
    if (event === "messages.upsert" || event === "MESSAGES_UPSERT") {
      const data = payload.data || {};
      const key = data.key || {};
      const remoteJid: string = key.remoteJid || "";
      const fromMe: boolean = !!key.fromMe;
      const messageId: string = key.id || "";

      // Ignore groups & broadcasts
      if (remoteJid.includes("@g.us") || remoteJid.includes("status@broadcast")) {
        return new Response(JSON.stringify({ ok: true, skipped: "group" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const phone = remoteJid.split("@")[0].replace(/\D/g, "");
      if (!phone) {
        return new Response(JSON.stringify({ ok: true, skipped: "noPhone" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Dedupe: skip if we already stored this message id (avoids double when our own send echoes back)
      if (messageId) {
        const { data: existing } = await supabase
          .from("chat_messages")
          .select("id")
          .eq("zapi_message_id", messageId)
          .maybeSingle();
        if (existing) {
          return new Response(JSON.stringify({ ok: true, skipped: "duplicate" }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      // Extract text + media
      const msg = data.message || {};
      const text =
        msg.conversation ||
        msg.extendedTextMessage?.text ||
        msg.imageMessage?.caption ||
        msg.videoMessage?.caption ||
        msg.documentMessage?.caption ||
        msg.buttonsResponseMessage?.selectedDisplayText ||
        msg.listResponseMessage?.title ||
        "";

      let mediaType: string | null = null;
      const mediaUrl: string | null = msg.imageMessage?.url || msg.videoMessage?.url || msg.audioMessage?.url || msg.documentMessage?.url || null;
      if (msg.imageMessage) mediaType = "image";
      else if (msg.videoMessage) mediaType = "video";
      else if (msg.audioMessage) mediaType = "audio";
      else if (msg.documentMessage) mediaType = "document";

      const pushName: string = data.pushName || phone;
      const direction = fromMe ? "outbound" : "inbound";

      // Upsert lead by phone
      const { data: existingLead } = await supabase
        .from("leads")
        .select("id")
        .eq("phone", phone)
        .eq("user_id", account.user_id)
        .maybeSingle();

      let leadId = existingLead?.id;
      if (!leadId) {
        const { data: newLead, error: leadErr } = await supabase
          .from("leads")
          .insert({
            user_id: account.user_id,
            phone,
            name: pushName,
            origin: "evolution",
            chat_status: fromMe ? "respondidas" : "aguardando_respostas",
          })
          .select("id")
          .single();
        if (leadErr) {
          console.error("Failed to create lead:", leadErr);
          return new Response(JSON.stringify({ error: leadErr.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        leadId = newLead.id;
      }

      // Insert chat message (inbound from contact OR outbound sent from the phone)
      await supabase.from("chat_messages").insert({
        lead_id: leadId,
        direction,
        content: text || (mediaType ? `[${mediaType}]` : "(sem conteúdo)"),
        media_type: mediaType,
        media_url: mediaUrl,
        zapi_message_id: messageId,
        status: fromMe ? "sent" : "received",
        account_id: account.id,
      });

      // Only trigger flows on real inbound replies
      if (!fromMe) {
        try {
          await fetch(`${supabaseUrl}/functions/v1/flow-processor`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify({ inbound_lead_id: leadId, inbound_text: text }),
          }).catch(() => {});
        } catch {}
      }

      return new Response(JSON.stringify({ ok: true, lead_id: leadId, direction }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ============= Status updates =============
    if (event === "messages.update" || event === "MESSAGES_UPDATE") {
      const data = payload.data || {};
      const messageId = data.key?.id;
      const status = data.status; // DELIVERY_ACK / READ / etc.
      if (messageId && status) {
        const updates: any = {};
        if (status === "READ" || status === 4) {
          updates.read_at = new Date().toISOString();
          updates.status = "read";
        } else if (status === "DELIVERY_ACK" || status === 3) {
          updates.delivered_at = new Date().toISOString();
          updates.status = "delivered";
        }
        if (Object.keys(updates).length > 0) {
          await supabase.from("chat_messages").update(updates).eq("zapi_message_id", messageId);
        }
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Evolution webhook error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
