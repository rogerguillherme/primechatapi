import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
    const ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN");

    if (!PHONE_NUMBER_ID) {
      throw new Error("WHATSAPP_PHONE_NUMBER_ID is not configured");
    }
    if (!ACCESS_TOKEN) {
      throw new Error("WHATSAPP_ACCESS_TOKEN is not configured");
    }

    const { phone, message, lead_id, media_url, media_type, template_name, template_language, template_params, interactive_buttons, cta_url } = await req.json();

    if (!phone || (!message && !media_url && !template_name && !interactive_buttons && !cta_url)) {
      return new Response(
        JSON.stringify({ error: "phone and (message, media_url, template_name, interactive_buttons, or cta_url) are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Format phone: remove non-digits
    const cleanPhone = phone.replace(/\D/g, "");

    const apiUrl = `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`;

    let body: any;

    if (template_name) {
      // WhatsApp Cloud API template message
      const templateBody: any = {
        messaging_product: "whatsapp",
        to: cleanPhone,
        type: "template",
        template: {
          name: template_name,
          language: { code: template_language || "pt_BR" },
        },
      };
      // Add components with parameters if provided
      if (template_params && Array.isArray(template_params) && template_params.length > 0) {
        const mappedParams = template_params.map((p: any) => 
          typeof p === "string" ? { type: "text", text: p } : p
        );
        // Reject if any text param has empty value
        const hasEmpty = mappedParams.some((p: any) => p.type === "text" && (!p.text || p.text.trim() === ""));
        if (hasEmpty) {
          return new Response(
            JSON.stringify({ error: "Template parameters contain empty values. All text parameters must have a value." }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        templateBody.template.components = [
          {
            type: "body",
            parameters: mappedParams,
          },
        ];
      }
      body = templateBody;
    } else if (media_url && media_type) {
      if (media_type === "image") {
        body = {
          messaging_product: "whatsapp",
          to: cleanPhone,
          type: "image",
          image: { link: media_url, caption: message || undefined },
        };
      } else if (media_type === "video") {
        body = {
          messaging_product: "whatsapp",
          to: cleanPhone,
          type: "video",
          video: { link: media_url, caption: message || undefined },
        };
      } else if (media_type === "audio") {
        body = {
          messaging_product: "whatsapp",
          to: cleanPhone,
          type: "audio",
          audio: { link: media_url },
        };
      } else {
        body = {
          messaging_product: "whatsapp",
          to: cleanPhone,
          type: "document",
          document: { link: media_url, caption: message || undefined },
        };
      }
    } else if (interactive_buttons && Array.isArray(interactive_buttons) && interactive_buttons.length > 0) {
      // Interactive button message (no template needed)
      body = {
        messaging_product: "whatsapp",
        to: cleanPhone,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: message || "Escolha uma opção:" },
          action: {
            buttons: interactive_buttons.slice(0, 3).map((btn: any, i: number) => ({
              type: "reply",
              reply: {
                id: btn.id || `btn_${i}`,
                title: (btn.title || `Opção ${i + 1}`).substring(0, 20),
              },
            })),
          },
        },
      };
    } else if (cta_url) {
      // CTA URL button message
      body = {
        messaging_product: "whatsapp",
        to: cleanPhone,
        type: "interactive",
        interactive: {
          type: "cta_url",
          body: { text: message || "Acesse o link abaixo:" },
          action: {
            name: "cta_url",
            parameters: {
              display_text: (cta_url.display_text || "Acessar").substring(0, 20),
              url: cta_url.url,
            },
          },
        },
      };
    } else {
      body = {
        messaging_product: "whatsapp",
        to: cleanPhone,
        type: "text",
        text: { body: message },
      };
    }

    console.log("WhatsApp Cloud API request:", JSON.stringify(body));

    const waRes = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
      body: JSON.stringify(body),
    });

    const waText = await waRes.text();
    console.log("WhatsApp Cloud API response:", waRes.status, waText);

    let waData: any;
    try {
      waData = JSON.parse(waText);
    } catch {
      waData = { raw: waText };
    }

    if (!waRes.ok) {
      throw new Error(`WhatsApp API error [${waRes.status}]: ${waText}`);
    }

    const waMessageId = waData.messages?.[0]?.id || null;

    // Save to database if lead_id provided
    if (lead_id) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseKey);

      const contentText = template_name 
        ? `📋 Template: ${template_name}` 
        : interactive_buttons
        ? `🔘 ${message || "Mensagem com botões"}`
        : cta_url
        ? `🔗 ${message || "Botão com link"}`
        : message || (media_type === "audio" ? "🎤 Áudio" : media_type === "image" ? "📷 Imagem" : media_type === "video" ? "🎥 Vídeo" : "📎 Arquivo");

      await supabase.from("chat_messages").insert({
        lead_id,
        direction: "outbound",
        content: contentText,
        media_type: media_type || null,
        media_url: media_url || null,
        zapi_message_id: waMessageId,
        status: "sent",
      });
    }

    return new Response(
      JSON.stringify({ success: true, messageId: waMessageId }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error sending WhatsApp message:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
