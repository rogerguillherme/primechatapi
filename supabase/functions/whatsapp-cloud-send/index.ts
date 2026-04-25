import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function getAccountCredentials(supabase: any, accountId?: string) {
  const baseSelect = "id, phone_number_id, access_token, business_account_id, provider, api_key";

  if (accountId) {
    const { data, error } = await supabase
      .from("whatsapp_accounts")
      .select(baseSelect)
      .eq("id", accountId)
      .maybeSingle();
    if (error) throw new Error(`Failed to fetch account: ${error.message}`);
    if (data) {
      return {
        accountId: data.id,
        phoneNumberId: data.phone_number_id,
        accessToken: data.access_token,
        businessAccountId: data.business_account_id,
        provider: (data.provider as string) || "meta_cloud",
        apiKey: data.api_key as string | null,
      };
    }
  }

  // Fallback: try default account from DB
  const { data: defaultAcc } = await supabase
    .from("whatsapp_accounts")
    .select(baseSelect)
    .eq("is_default", true)
    .maybeSingle();
  if (defaultAcc) {
    return {
      accountId: defaultAcc.id,
      phoneNumberId: defaultAcc.phone_number_id,
      accessToken: defaultAcc.access_token,
      businessAccountId: defaultAcc.business_account_id,
      provider: (defaultAcc.provider as string) || "meta_cloud",
      apiKey: defaultAcc.api_key as string | null,
    };
  }

  // Fallback: try first account
  const { data: firstAcc } = await supabase
    .from("whatsapp_accounts")
    .select(baseSelect)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (firstAcc) {
    return {
      accountId: firstAcc.id,
      phoneNumberId: firstAcc.phone_number_id,
      accessToken: firstAcc.access_token,
      businessAccountId: firstAcc.business_account_id,
      provider: (firstAcc.provider as string) || "meta_cloud",
      apiKey: firstAcc.api_key as string | null,
    };
  }

  // Final fallback: env vars (always meta_cloud)
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  if (phoneNumberId && accessToken) return { phoneNumberId, accessToken, provider: "meta_cloud", apiKey: null };

  throw new Error("No WhatsApp account configured");
}

async function ensureWebhookSubscription(accessToken: string, businessAccountId?: string | null) {
  if (!businessAccountId || !accessToken) return;

  try {
    const subRes = await fetch(`https://graph.facebook.com/v21.0/${businessAccountId}/subscribed_apps`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const subText = await subRes.text();
    console.log("WABA subscription check:", subRes.status, subText);
  } catch (error) {
    console.error("Failed to ensure WABA subscription:", error);
  }
}

async function getTemplateRecord(supabase: any, templateName: string, accountId?: string) {
  const { data: templates, error } = await supabase
    .from("chat_templates")
    .select("id, template_name, template_language, template_params, content, meta_status, updated_at")
    .eq("template_name", templateName)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch template metadata: ${error.message}`);
  }

  if (!templates || templates.length === 0) {
    return { template: null, hasExplicitLinks: false };
  }

  const templateIds = templates.map((template: any) => template.id);
  const { data: links, error: linkError } = await supabase
    .from("account_templates")
    .select("account_id, template_id")
    .in("template_id", templateIds);

  if (linkError) {
    throw new Error(`Failed to fetch template links: ${linkError.message}`);
  }

  const templateLinks = links || [];
  const globalTemplate = templates.find(
    (template: any) => !templateLinks.some((link: any) => link.template_id === template.id),
  );

  if (accountId) {
    const linkedTemplate = templates.find((template: any) =>
      templateLinks.some((link: any) => link.template_id === template.id && link.account_id === accountId),
    );

    if (linkedTemplate) {
      return { template: linkedTemplate, hasExplicitLinks: true };
    }

    if (globalTemplate) {
      return { template: globalTemplate, hasExplicitLinks: false };
    }

    return { template: null, hasExplicitLinks: templateLinks.length > 0 };
  }

  return { template: globalTemplate || templates[0], hasExplicitLinks: templateLinks.length > 0 };
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

    const {
      accountId: resolvedAccountId,
      phoneNumberId: PHONE_NUMBER_ID,
      accessToken: ACCESS_TOKEN,
      businessAccountId,
      provider,
      apiKey: D360_API_KEY,
    } = await getAccountCredentials(supabase, account_id);

    const isD360 = provider === "d360";
    const isEvolution = provider === "evolution";

    if (!isD360 && !isEvolution) {
      await ensureWebhookSubscription(ACCESS_TOKEN, businessAccountId);
    }

    const cleanPhone = phone.replace(/\D/g, "");

    // ============= EVOLUTION API (self-hosted) =============
    // business_account_id stores Server URL; phone_number_id stores Instance Name; api_key stores apikey.
    if (isEvolution) {
      const evoApiKey = D360_API_KEY || ACCESS_TOKEN;
      const evoServerUrl = (businessAccountId || "").trim().replace(/\/+$/, "");
      const evoInstance = (PHONE_NUMBER_ID || "").trim();

      if (!evoApiKey || !evoServerUrl || !evoInstance) {
        return new Response(
          JSON.stringify({ error: "Configuração da Evolution API incompleta (Server URL, Instance e API Key são obrigatórios). Edite a conta nas configurações." }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Resolve dynamic content: template fallback to stored content
      let outgoingText = message || "";
      let templateContentRecord: any = null;
      if (template_name && !outgoingText) {
        const lookup = await getTemplateRecord(supabase, template_name, account_id);
        templateContentRecord = lookup.template;
        if (templateContentRecord?.content) {
          const { data: leadData } = lead_id
            ? await supabase.from("leads").select("name").eq("id", lead_id).maybeSingle()
            : { data: null };
          const firstName = (leadData?.name || "").split(" ")[0] || "amigo(a)";
          outgoingText = String(templateContentRecord.content)
            .replace(/\{nome\}/gi, firstName)
            .replace(/\{\{1\}\}/g, firstName)
            .replace(/\{codigo\}/gi, "-");
        }
      }

      const evoHeaders = {
        "Content-Type": "application/json",
        "apikey": evoApiKey,
      };

      let endpoint = "";
      let evoBody: any = {};
      let logContent = outgoingText;

      // Decide endpoint based on payload type
      if (interactive_buttons && Array.isArray(interactive_buttons) && interactive_buttons.length > 0) {
        // Baileys/Evolution sends buttons as `interactiveMessage` which modern WhatsApp client
        // silently drops on personal numbers. Convert to numbered text list — guaranteed delivery.
        const bodyText = (outgoingText || "Escolha uma opção:").trim();
        const optionsList = interactive_buttons
          .slice(0, 10)
          .map((btn: any, i: number) => `*${i + 1}*. ${btn.title || `Opção ${i + 1}`}`)
          .join("\n");
        const fullText = `${bodyText}\n\n${optionsList}\n\n_Responda com o número da opção._`;
        endpoint = `${evoServerUrl}/message/sendText/${evoInstance}`;
        evoBody = { number: cleanPhone, text: fullText };
        logContent = `🔘 ${bodyText}`;
      } else if (cta_url) {
        // Evolution doesn't have a native CTA; send as text + URL
        const ctaText = `${outgoingText || "Acesse o link abaixo:"}\n\n👉 ${cta_url.display_text || "Acessar"}: ${cta_url.url}`;
        endpoint = `${evoServerUrl}/message/sendText/${evoInstance}`;
        evoBody = { number: cleanPhone, text: ctaText };
        logContent = `🔗 ${outgoingText || cta_url.url}`;
      } else if (media_url && media_type) {
        endpoint = `${evoServerUrl}/message/sendMedia/${evoInstance}`;
        const mediaTypeMap: Record<string, string> = {
          image: "image",
          video: "video",
          audio: "audio",
          document: "document",
        };
        const evoMediaType = mediaTypeMap[media_type] || "document";

        // Download media and convert to base64 — Evolution's axios fetch fails on some public URLs (returns 400).
        // Base64 is the most reliable transport.
        let mediaPayload = media_url;
        let mimeType = "";
        try {
          const mediaRes = await fetch(media_url);
          if (mediaRes.ok) {
            mimeType = mediaRes.headers.get("content-type") || "";
            const buf = new Uint8Array(await mediaRes.arrayBuffer());
            // Convert to base64 in chunks to avoid call stack overflow on large files
            let binary = "";
            const chunkSize = 0x8000;
            for (let i = 0; i < buf.length; i += chunkSize) {
              binary += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + chunkSize)) as any);
            }
            mediaPayload = btoa(binary);
            console.log(`Media downloaded: ${buf.length} bytes, mime: ${mimeType}`);
          } else {
            console.warn(`Failed to download media (${mediaRes.status}), falling back to URL`);
          }
        } catch (err) {
          console.warn("Media download error, falling back to URL:", err);
        }

        if (media_type === "audio") {
          endpoint = `${evoServerUrl}/message/sendWhatsAppAudio/${evoInstance}`;
          evoBody = { number: cleanPhone, audio: mediaPayload };
        } else {
          // Pick filename + extension by mime/media type
          const extByType: Record<string, string> = {
            image: mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg",
            video: "mp4",
            document: mimeType.includes("pdf") ? "pdf" : "bin",
          };
          const ext = extByType[media_type] || "bin";
          const fileName = media_type === "document" ? `arquivo.${ext}` : `media.${ext}`;
          evoBody = {
            number: cleanPhone,
            mediatype: evoMediaType,
            media: mediaPayload,
            mimetype: mimeType || undefined,
            caption: outgoingText || undefined,
            fileName,
          };
        }
        logContent = outgoingText || (
          media_type === "audio" ? "🎤 Áudio" : media_type === "image" ? "📷 Imagem" : media_type === "video" ? "🎥 Vídeo" : "📎 Arquivo"
        );
      } else {
        if (!outgoingText) outgoingText = "(sem conteúdo)";
        endpoint = `${evoServerUrl}/message/sendText/${evoInstance}`;
        evoBody = { number: cleanPhone, text: outgoingText };
        logContent = outgoingText;
      }

      console.log("Evolution request:", endpoint, JSON.stringify(evoBody).substring(0, 200));

      const eRes = await fetch(endpoint, {
        method: "POST",
        headers: evoHeaders,
        body: JSON.stringify(evoBody),
      });

      const eText = await eRes.text();
      console.log("Evolution response:", eRes.status, eText.substring(0, 400));
      let eData: any;
      try { eData = JSON.parse(eText); } catch { eData = { raw: eText }; }

      if (!eRes.ok) {
        const friendlyMsg = eData?.message || eData?.error || `Falha no envio via Evolution API (HTTP ${eRes.status}).`;
        if (lead_id) {
          await supabase.from("chat_messages").insert({
            lead_id,
            direction: "outbound",
            content: `❌ ${friendlyMsg}`,
            status: "failed",
            account_id: account_id || resolvedAccountId || null,
          });
        }
        return new Response(
          JSON.stringify({ error: friendlyMsg, provider_response: eData }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const messageId = eData?.key?.id || eData?.messageId || null;
      if (lead_id) {
        const activityAt = new Date().toISOString();
        await supabase.from("chat_messages").insert({
          lead_id,
          direction: "outbound",
          content: logContent,
          media_type: media_type || null,
          media_url: media_url || null,
          zapi_message_id: messageId,
          status: "sent",
          account_id: account_id || resolvedAccountId || null,
        });
        await supabase.from("leads").update({ last_outbound_at: activityAt, updated_at: activityAt }).eq("id", lead_id);
      }

      return new Response(
        JSON.stringify({ success: true, messageId }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const apiUrl = isD360
      ? `https://waba-v2.360dialog.io/messages`
      : `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`;

    let body: any;
    let templateRecord: any = null;

    if (template_name) {
      const templateLookup = await getTemplateRecord(supabase, template_name, account_id);
      templateRecord = templateLookup.template;

      if (!templateRecord) {
        const errorMessage = account_id && templateLookup.hasExplicitLinks
          ? `Template "${template_name}" não está vinculado à conta selecionada.`
          : `Template "${template_name}" não foi encontrado para envio.`;

        return new Response(
          JSON.stringify({ error: errorMessage }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (templateRecord.meta_status && templateRecord.meta_status !== "APPROVED" && templateRecord.meta_status !== "unknown") {
        return new Response(
          JSON.stringify({ error: `Template "${template_name}" ainda não está aprovado (${templateRecord.meta_status}). Aguarde a aprovação para enviar.` }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Pre-fetch lead for placeholder resolution (used in two places below)
      const { data: leadData } = lead_id
        ? await supabase.from("leads").select("name").eq("id", lead_id).maybeSingle()
        : { data: null };
      const leadFirstName = (leadData?.name || "").split(" ")[0] || "";

      let finalParams = template_params;
      let resolvedLanguage = template_language || templateRecord.template_language;
      if (!finalParams || !Array.isArray(finalParams) || finalParams.length === 0) {
        if (templateRecord.template_params && Array.isArray(templateRecord.template_params) && templateRecord.template_params.length > 0) {
          finalParams = (templateRecord.template_params as any[]).map((p: any) => {
            const text = typeof p === "string" ? p : p?.text || "";
            return {
              type: "text",
              text: text
                .replace(/\{nome\}/gi, leadFirstName || "amigo(a)")
                .replace(/\{\{1\}\}/g, leadFirstName || "amigo(a)")
                .replace(/\{codigo\}/gi, "-") || (leadFirstName || "amigo(a)"),
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
        const fallbackName = leadFirstName || "amigo(a)";
        const mappedParams = finalParams
          .map((p: any) => typeof p === "string" ? { type: "text", text: p || fallbackName } : { type: "text", text: p.text || fallbackName })
          .map((p: any) => ({
            ...p,
            // Replace unresolved {{N}} placeholders with the lead's first name
            text: p.text.replace(/\{\{\d+\}\}/g, fallbackName).trim() || fallbackName,
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

    // 360dialog API uses the same body shape but without `messaging_product`
    if (isD360) {
      delete body.messaging_product;
    }

    console.log(`WhatsApp ${isD360 ? "360dialog" : "Cloud"} API request:`, JSON.stringify(body));

    const requestHeaders: Record<string, string> = { "Content-Type": "application/json" };
    if (isD360) {
      if (!D360_API_KEY) {
        return new Response(
          JSON.stringify({ error: "D360-API-KEY não configurada para esta conta. Edite a conta nas configurações." }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      requestHeaders["D360-API-KEY"] = D360_API_KEY;
    } else {
      requestHeaders["Authorization"] = `Bearer ${ACCESS_TOKEN}`;
    }

    const waRes = await fetch(apiUrl, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(body),
    });

    const waText = await waRes.text();
    console.log("WhatsApp Cloud API response:", waRes.status, waText);

    let waData: any;
    try { waData = JSON.parse(waText); } catch { waData = { raw: waText }; }

    if (!waRes.ok) {
      const errorCode = waData?.error?.code;
      const errorSubcode = waData?.error?.error_subcode;
      const metaMsg = waData?.error?.message || "";

      const isTemplateNotFound = errorCode === 132001;
      const isParamsMismatch = errorCode === 132000;
      const isGenericUserError = errorCode === 135000;
      const isAuthError = errorCode === 190;
      const isOutsideWindow = errorCode === 131047 || errorCode === 131051;
      const isInvalidPhone = errorCode === 131026 || errorCode === 131000;
      const isRateLimit = errorCode === 130429 || errorCode === 80007;

      // Friendly Portuguese error messages
      let friendlyMsg: string;
      if (isTemplateNotFound) {
        friendlyMsg = `O template "${template_name || ''}" não foi encontrado na Meta com o idioma "${body?.template?.language?.code || ''}". Verifique o nome e idioma do template.`;
      } else if (isParamsMismatch) {
        friendlyMsg = `O template "${template_name || ''}" exige variáveis que não foram preenchidas (ex: {{1}}). Edite o template e configure os parâmetros.`;
      } else if (isGenericUserError) {
        friendlyMsg = `A Meta recusou o envio do template "${template_name || ''}". Causas comuns: template ainda não aprovado, idioma errado, conta sem Verificação de Negócio, ou número bloqueado para receber.`;
      } else if (isAuthError) {
        const loggedOutHint = errorSubcode === 467 ? " A sessão da Meta expirou." : "";
        friendlyMsg = `O token da conta WhatsApp expirou.${loggedOutHint} Reconecte a conta na tela de configurações.`;
      } else if (isOutsideWindow) {
        friendlyMsg = `Esse contato está fora da janela de 24h e só pode receber templates aprovados (não mensagens livres).`;
      } else if (isInvalidPhone) {
        friendlyMsg = `O número de telefone "${cleanPhone}" não é um WhatsApp válido ou não existe.`;
      } else if (isRateLimit) {
        friendlyMsg = `Limite de envios da Meta atingido. Aguarde alguns minutos e tente novamente.`;
      } else {
        friendlyMsg = `Falha no envio: ${metaMsg || `erro HTTP ${waRes.status}`}.`;
      }

      // Persist failure in chat_messages so it appears in the conversation thread
      if (lead_id) {
        const failContent = template_name
          ? `📋 Template "${template_name}" — ❌ ${friendlyMsg}`
          : `❌ ${friendlyMsg}`;
        await supabase.from("chat_messages").insert({
          lead_id,
          direction: "outbound",
          content: failContent,
          media_type: media_type || null,
          media_url: media_url || null,
          status: "failed",
          account_id: account_id || resolvedAccountId || null,
        });
      }

      const isKnownError = isTemplateNotFound || isParamsMismatch || isGenericUserError || isAuthError || isOutsideWindow || isInvalidPhone || isRateLimit;
      const statusCode = isKnownError || waRes.status < 500 ? 422 : 502;

      return new Response(
        JSON.stringify({ error: friendlyMsg, wa_error: waData?.error }),
        { status: statusCode, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const waMessageId = waData.messages?.[0]?.id || null;

    if (lead_id) {
      const activityAt = new Date().toISOString();
      let contentText = message || "";
      if (template_name) {
        contentText = templateRecord?.content || `📋 Template: ${template_name}`;
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
        account_id: account_id || resolvedAccountId || null,
      });

      const { error: leadUpdateError } = await supabase
        .from("leads")
        .update({ last_outbound_at: activityAt, updated_at: activityAt })
        .eq("id", lead_id);

      if (leadUpdateError) {
        console.error("Failed to update lead outbound activity:", leadUpdateError);
      }
    }

    return new Response(
      JSON.stringify({ success: true, messageId: waMessageId }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error sending WhatsApp message:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
