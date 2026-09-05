import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { identificarChamador } from "../_shared/caller.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const INSTANCE_ID = Deno.env.get("ZAPI_INSTANCE_ID");
    const TOKEN = Deno.env.get("ZAPI_TOKEN");
    const CLIENT_TOKEN = Deno.env.get("ZAPI_CLIENT_TOKEN");

    if (!INSTANCE_ID || !TOKEN || !CLIENT_TOKEN) {
      throw new Error("ZAPI credentials not configured");
    }

    const { phone, message, lead_id, media_url, media_type } = await req.json();

    if (!lead_id) {
      return new Response(
        JSON.stringify({ error: "lead_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Envia pelo número do cliente com credenciais compartilhadas, e o alvo
    // vinha só do corpo. A anon key é pública: sem esta checagem, qualquer um
    // mandava mensagem em nome do cliente para o lead que quisesse.
    const chamador = await identificarChamador(req);
    if (!chamador.interno) {
      if (!chamador.userId) {
        return new Response(
          JSON.stringify({ error: "Não autenticado" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const admin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const { data: dono } = await admin
        .from("leads")
        .select("id")
        .eq("id", lead_id)
        .eq("user_id", chamador.userId)
        .maybeSingle();
      if (!dono) {
        return new Response(
          JSON.stringify({ error: "Sem permissão sobre este lead" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    if (!message && !media_url) {
      return new Response(
        JSON.stringify({ error: "message or media_url is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const baseUrl = `https://api.z-api.io/instances/${INSTANCE_ID}/token/${TOKEN}`;
    const headers = {
      "Content-Type": "application/json",
      "Client-Token": CLIENT_TOKEN,
    };

    let zapiData: any;
    let endpoint: string;
    let body: any;
    let sentMediaType: string | null = null;

    if (media_url && media_type) {
      sentMediaType = media_type;

      if (media_type === "audio") {
        endpoint = `${baseUrl}/send-audio`;
        body = { phone, audio: media_url };
      } else if (media_type === "image") {
        endpoint = `${baseUrl}/send-image`;
        body = { phone, image: media_url, caption: message || "" };
      } else if (media_type === "video") {
        endpoint = `${baseUrl}/send-video`;
        body = { phone, video: media_url, caption: message || "" };
      } else {
        // Document or other
        endpoint = `${baseUrl}/send-document/pdf`;
        body = { phone, document: media_url, fileName: "document", caption: message || "" };
      }
    } else {
      // Text-only message
      endpoint = `${baseUrl}/send-text`;
      body = { phone, message };
    }

    console.log("ZAPI request:", JSON.stringify({ endpoint, body }));

    const zapiRes = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const zapiText = await zapiRes.text();
    console.log("ZAPI response status:", zapiRes.status, "body:", zapiText);

    try {
      zapiData = JSON.parse(zapiText);
    } catch {
      zapiData = { raw: zapiText };
    }

    if (!zapiRes.ok) {
      throw new Error(`ZAPI error [${zapiRes.status}]: ${zapiText}`);
    }

    // Save to database
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const activityAt = new Date().toISOString();
    const contentText = message || (sentMediaType === "audio" ? "🎤 Áudio" : sentMediaType === "image" ? "📷 Imagem" : sentMediaType === "video" ? "🎥 Vídeo" : "📎 Arquivo");

    await supabase.from("chat_messages").insert({
      lead_id,
      direction: "outbound",
      content: contentText,
      media_type: sentMediaType,
      media_url: media_url || null,
      zapi_message_id: zapiData.messageId || null,
      status: "sent",
    });

    const { error: leadUpdateError } = await supabase
      .from("leads")
      .update({ last_outbound_at: activityAt, updated_at: activityAt })
      .eq("id", lead_id);

    if (leadUpdateError) {
      console.error("Failed to update lead outbound activity:", leadUpdateError);
    }

    return new Response(
      JSON.stringify({ success: true, messageId: zapiData.messageId }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error sending message:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
