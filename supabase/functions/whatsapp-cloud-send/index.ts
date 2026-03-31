import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function getAccountCredentials(supabase: any, accountId?: string) {
  if (accountId) {
    const { data, error } = await supabase
      .from("whatsapp_accounts")
      .select("phone_number_id, access_token")
      .eq("id", accountId)
      .maybeSingle();
    if (error) throw new Error(`Failed to fetch account: ${error.message}`);
    if (data) return { phoneNumberId: data.phone_number_id, accessToken: data.access_token };
  }

  // Fallback: try default account from DB
  const { data: defaultAcc } = await supabase
    .from("whatsapp_accounts")
    .select("phone_number_id, access_token")
    .eq("is_default", true)
    .maybeSingle();
  if (defaultAcc) return { phoneNumberId: defaultAcc.phone_number_id, accessToken: defaultAcc.access_token };

  // Fallback: try first account
  const { data: firstAcc } = await supabase
    .from("whatsapp_accounts")
    .select("phone_number_id, access_token")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (firstAcc) return { phoneNumberId: firstAcc.phone_number_id, accessToken: firstAcc.access_token };

  // Final fallback: env vars
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  if (phoneNumberId && accessToken) return { phoneNumberId, accessToken };

  throw new Error("No WhatsApp account configured");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { phone, message, lead_id, media_url, media_type, template_name, template_language, template_params, interactive_buttons, cta_url, account_id } = await req.json();

    if (!phone || (!message && !media_url && !template_name && !interactive_buttons && !cta_url)) {
      return new Response(
        JSON.stringify({ error: "phone and (message, media_url, template_name, interactive_buttons, or cta_url) are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { phoneNumberId: PHONE_NUMBER_ID, accessToken: ACCESS_TOKEN } = await getAccountCredentials(supabase, account_id);

    const cleanPhone = phone.replace(/\D/g, "");
    const apiUrl = `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`;

    let body: any;

    if (template_name) {
      // If no template_params provided, try to fetch from DB
      let finalParams = template_params;
      let resolvedLanguage = template_language;
      if (!finalParams || !Array.isArray(finalParams) || finalParams.length === 0) {
        const { data: tmpl } = await supabase
          .from("chat_templates")
          .select("template_params, template_language")
          .eq("template_name", template_name)
          .maybeSingle();
        if (tmpl?.template_language && !resolvedLanguage) {
          resolvedLanguage = tmpl.template_language;
        }
        if (tmpl?.template_params && Array.isArray(tmpl.template_params) && tmpl.template_params.length > 0) {
          // Resolve placeholders with lead info
          const { data: leadData } = lead_id
            ? await supabase.from("leads").select("name").eq("id", lead_id).maybeSingle()
            : { data: null };
          const leadName = leadData?.name || "";
          finalParams = (tmpl.template_params as any[]).map((p: any) => {
            const text = typeof p === "string" ? p : p?.text || "";
            return {
              type: "text",
              text: text
                .replace(/\{nome\}/g, leadName.split(" ")[0] || "-")
                .replace(/\{codigo\}/g, "-") || "-",
            };
          });
        }
      }

      const templateBody: any = {
        messaging_product: "whatsapp",
        to: cleanPhone,
        type: "template",
        template: {
          name: template_name,
          language: { code: resolvedLanguage || "pt_BR" },
        },
      };
      if (finalParams && Array.isArray(finalParams) && finalParams.length > 0) {
        // Filter out empty/placeholder params and resolve unresolved placeholders
        const mappedParams = finalParams
          .map((p: any) => typeof p === "string" ? { type: "text", text: p || "-" } : { type: "text", text: p.text || "-" })
          .map((p: any) => ({
            ...p,
            // Replace unresolved {{N}} placeholders with a dash to avoid Meta rejection
            text: p.text.replace(/\{\{\d+\}\}/g, "-").trim() || "-",
          }))
          .filter((p: any) => p.text && p.text.trim() !== "");
        if (mappedParams.length > 0) {
          templateBody.template.components = [{ type: "body", parameters: mappedParams }];
        }
      }
      body = templateBody;
    } else if (media_url && media_type) {
      if (media_type === "image") {
        body = { messaging_product: "whatsapp", to: cleanPhone, type: "image", image: { link: media_url, caption: message || undefined } };
      } else if (media_type === "video") {
        body = { messaging_product: "whatsapp", to: cleanPhone, type: "video", video: { link: media_url, caption: message || undefined } };
      } else if (media_type === "audio") {
        body = { messaging_product: "whatsapp", to: cleanPhone, type: "audio", audio: { link: media_url } };
      } else {
        body = { messaging_product: "whatsapp", to: cleanPhone, type: "document", document: { link: media_url, caption: message || undefined } };
      }
    } else if (interactive_buttons && Array.isArray(interactive_buttons) && interactive_buttons.length > 0) {
      body = {
        messaging_product: "whatsapp", to: cleanPhone, type: "interactive",
        interactive: {
          type: "button",
          body: { text: message || "Escolha uma opção:" },
          action: {
            buttons: interactive_buttons.slice(0, 3).map((btn: any, i: number) => ({
              type: "reply", reply: { id: btn.id || `btn_${i}`, title: (btn.title || `Opção ${i + 1}`).substring(0, 20) },
            })),
          },
        },
      };
    } else if (cta_url) {
      body = {
        messaging_product: "whatsapp", to: cleanPhone, type: "interactive",
        interactive: {
          type: "cta_url",
          body: { text: message || "Acesse o link abaixo:" },
          action: { name: "cta_url", parameters: { display_text: (cta_url.display_text || "Acessar").substring(0, 20), url: cta_url.url } },
        },
      };
    } else {
      body = { messaging_product: "whatsapp", to: cleanPhone, type: "text", text: { body: message } };
    }

    console.log("WhatsApp Cloud API request:", JSON.stringify(body));

    const waRes = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ACCESS_TOKEN}` },
      body: JSON.stringify(body),
    });

    const waText = await waRes.text();
    console.log("WhatsApp Cloud API response:", waRes.status, waText);

    let waData: any;
    try { waData = JSON.parse(waText); } catch { waData = { raw: waText }; }

    if (!waRes.ok) {
      const errorCode = waData?.error?.code;
      const errorSubcode = waData?.error?.error_subcode;

      const isTemplateNotFound = errorCode === 132001;
      const isParamsMismatch = errorCode === 132000;
      const isGenericUserError = errorCode === 135000;
      const isAuthError = errorCode === 190;

      let errorMsg: string;
      if (isTemplateNotFound) {
        errorMsg = `Template "${template_name || ''}" não encontrado na Meta com idioma "${body?.template?.language?.code || ''}". Verifique o nome e idioma no Facebook Business Manager.`;
      } else if (isParamsMismatch) {
        errorMsg = `Template "${template_name || ''}" requer parâmetros que não foram enviados. Configure os parâmetros do template no sistema (ex: {{1}}).`;
      } else if (isGenericUserError) {
        errorMsg = `Erro genérico da Meta ao enviar template "${template_name || ''}". Possíveis causas: template não aprovado, idioma "${body?.template?.language?.code || ''}" incorreto, quantidade de parâmetros não bate com o template, ou janela de 24h expirada. Verifique no WhatsApp Manager.`;
      } else if (isAuthError) {
        const loggedOutHint = errorSubcode === 467 ? " Sessão inválida (usuário desconectado)." : "";
        errorMsg = `Token de acesso da conta WhatsApp inválido ou expirado.${loggedOutHint} Gere um novo token permanente no Meta Business Manager e atualize a conta.`;
      } else {
        errorMsg = `WhatsApp API error [${waRes.status}]: ${waText}`;
      }

      const isKnownError = isTemplateNotFound || isParamsMismatch || isGenericUserError || isAuthError;
      const statusCode = isKnownError || waRes.status < 500 ? 422 : 502;

      return new Response(
        JSON.stringify({ error: errorMsg, wa_error: waData?.error }),
        { status: statusCode, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const waMessageId = waData.messages?.[0]?.id || null;

    if (lead_id) {
      let contentText = message || "";
      if (template_name) {
        // Try to get the real template content from DB
        const { data: tmplRecord } = await supabase
          .from("chat_templates")
          .select("content")
          .eq("template_name", template_name)
          .maybeSingle();
        contentText = tmplRecord?.content || `📋 Template: ${template_name}`;
      } else if (interactive_buttons) {
        contentText = `🔘 ${message || "Mensagem com botões"}`;
      } else if (cta_url) {
        contentText = `🔗 ${message || "Botão com link"}`;
      } else if (!message) {
        contentText = media_type === "audio" ? "🎤 Áudio" : media_type === "image" ? "📷 Imagem" : media_type === "video" ? "🎥 Vídeo" : "📎 Arquivo";
      }

      await supabase.from("chat_messages").insert({
        lead_id, direction: "outbound", content: contentText,
        media_type: media_type || null, media_url: media_url || null,
        zapi_message_id: waMessageId, status: "sent",
        account_id: account_id || null,
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
