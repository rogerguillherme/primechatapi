import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkWebhookSecret } from "../_shared/webhook-secret.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("55")) return digits;
  return "55" + digits;
}

async function downloadAndStoreMedia(
  supabase: any,
  mediaUrl: string,
  mediaType: string,
  messageId: string
): Promise<string | null> {
  try {
    const response = await fetch(mediaUrl);
    if (!response.ok) {
      console.error("Failed to download media:", response.status);
      return mediaUrl; // fallback to original URL
    }
    const blob = await response.blob();
    const ext = mediaType === "image" ? "jpg" : mediaType === "audio" ? "ogg" : "mp4";
    const path = `incoming/${messageId}.${ext}`;

    const { error } = await supabase.storage
      .from("chat-media")
      .upload(path, blob, { contentType: blob.type, upsert: true });

    if (error) {
      console.error("Failed to upload media to storage:", error);
      return mediaUrl;
    }

    const { data: publicUrl } = supabase.storage
      .from("chat-media")
      .getPublicUrl(path);

    return publicUrl.publicUrl;
  } catch (e) {
    console.error("Error storing media:", e);
    return mediaUrl;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (!checkWebhookSecret(req, "ZAPI_WEBHOOK_SECRET")) {
    console.error("zapi-webhook: segredo ausente ou inválido");
    return new Response("Forbidden", { status: 403, headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    console.log("ZAPI webhook received:", JSON.stringify(payload));

    // Skip non-message events
    const eventType = payload.type || "";
    if (eventType === "PresenceChatCallback" || eventType === "StatusCallback" || eventType === "DisconnectedCallback" || eventType === "ConnectedCallback" || eventType === "MessageStatusCallback") {
      return new Response(
        JSON.stringify({ ok: true, skipped: "non-message event" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Skip group messages
    const isGroup = payload.isGroup === true || (payload.phone || "").includes("-") || (payload.chatName || "").includes("@g.us");
    if (isGroup) {
      return new Response(
        JSON.stringify({ ok: true, skipped: "group message" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rawPhone = payload.phone?.replace(/\D/g, "") || "";
    const messageId = payload.messageId || payload.id || crypto.randomUUID();
    const senderName = payload.senderName || payload.chatName || "";
    const isFromMe = payload.fromMe === true;

    if (!rawPhone) {
      return new Response(
        JSON.stringify({ ok: true, skipped: "no phone" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Determine message content and media
    let text = "";
    let mediaType: string | null = null;
    let mediaUrl: string | null = null;

    // Text message
    if (payload.text?.message) {
      text = payload.text.message;
    } else if (payload.body) {
      text = payload.body;
    } else if (payload.message?.text) {
      text = payload.message.text;
    }

    // Image
    if (payload.image) {
      mediaType = "image";
      mediaUrl = payload.image.imageUrl || payload.image.thumbnailUrl || "";
      text = text || payload.image.caption || "";
    }

    // Audio
    if (payload.audio) {
      mediaType = "audio";
      mediaUrl = payload.audio.audioUrl || "";
    }

    // Video
    if (payload.video) {
      mediaType = "video";
      mediaUrl = payload.video.videoUrl || "";
      text = text || payload.video.caption || "";
    }

    // Document
    if (payload.document) {
      mediaType = "document";
      mediaUrl = payload.document.documentUrl || "";
      text = text || payload.document.caption || payload.document.fileName || "";
    }

    // Sticker
    if (payload.sticker) {
      mediaType = "image";
      mediaUrl = payload.sticker.stickerUrl || "";
    }

    // If no text and no media, skip
    if (!text && !mediaUrl) {
      return new Response(
        JSON.stringify({ ok: true, skipped: "no content" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const cleanPhone = normalizePhone(rawPhone);

    // Find or create lead
    let { data: lead } = await supabase
      .from("leads")
      .select("id, name")
      .or(`phone.eq.${cleanPhone},phone.eq.${rawPhone}`)
      .limit(1)
      .maybeSingle();

    if (!lead) {
      const newName = senderName || `WhatsApp ${rawPhone}`;
      console.log("Creating new lead from WhatsApp:", newName, cleanPhone);

      // Try to fetch profile photo from ZAPI
      let photoUrl: string | null = null;
      try {
        const INSTANCE_ID = Deno.env.get("ZAPI_INSTANCE_ID");
        const TOKEN = Deno.env.get("ZAPI_TOKEN");
        const CLIENT_TOKEN = Deno.env.get("ZAPI_CLIENT_TOKEN");
        if (INSTANCE_ID && TOKEN && CLIENT_TOKEN) {
          const picRes = await fetch(
            `https://api.z-api.io/instances/${INSTANCE_ID}/token/${TOKEN}/profile-picture/${cleanPhone}`,
            { headers: { "Client-Token": CLIENT_TOKEN } }
          );
          if (picRes.ok) {
            const picData = await picRes.json();
            photoUrl = picData.link || picData.imgUrl || null;
          }
        }
      } catch (e) {
        console.log("Could not fetch profile picture:", e);
      }

      const { data: newLead, error: createError } = await supabase
        .from("leads")
        .insert({ name: newName, phone: cleanPhone, origin: "whatsapp", photo_url: photoUrl })
        .select("id, name")
        .single();
      if (createError) throw createError;
      lead = newLead;
    } else if (senderName && lead.name.startsWith("WhatsApp ")) {
      await supabase.from("leads").update({ name: senderName }).eq("id", lead.id);
    }

    // Download and store media if present
    let storedMediaUrl = mediaUrl;
    if (mediaUrl) {
      storedMediaUrl = await downloadAndStoreMedia(supabase, mediaUrl, mediaType!, messageId);
    }

    // Save the message
    await supabase.from("chat_messages").insert({
      lead_id: lead!.id,
      direction: isFromMe ? "outbound" : "inbound",
      content: text || (mediaType === "audio" ? "🎤 Áudio" : mediaType === "image" ? "📷 Imagem" : mediaType === "video" ? "🎥 Vídeo" : "📎 Arquivo"),
      media_type: mediaType,
      media_url: storedMediaUrl,
      zapi_message_id: messageId,
      status: isFromMe ? "sent" : "received",
    });

    return new Response(
      JSON.stringify({ ok: true, lead_id: lead!.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("ZAPI webhook error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
