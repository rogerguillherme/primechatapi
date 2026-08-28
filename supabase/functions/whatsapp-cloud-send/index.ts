import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { applyStageAutomations } from "../_shared/stage-automations.ts";
import { resolveTemplateHeaderLink } from "../_shared/template-media.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ============================================================
// UNIQUENESS HELPERS — anti-spam / anti-duplicate detection
// Each outgoing message gets a unique invisible signature so
// providers cannot fingerprint identical payloads.
// ============================================================
const ZW_CHARS = ["\u200B", "\u200C", "\u200D", "\u2060"];

function uniqueZeroWidthSuffix(len = 8): string {
  let s = "";
  for (let i = 0; i < len; i++) s += ZW_CHARS[Math.floor(Math.random() * ZW_CHARS.length)];
  return s;
}

function varyName(rawName: string | null | undefined): string {
  const first = (rawName || "").trim().split(/\s+/)[0] || "";
  if (!first) return "amigo(a)";
  const variations = [
    first,
    first.toLowerCase(),
    first.charAt(0).toUpperCase() + first.slice(1).toLowerCase(),
  ];
  return variations[Math.floor(Math.random() * variations.length)];
}

function withUniqueSignature(text: string | null | undefined): string {
  return (text ?? "").toString();
}

type AccountCredentials = {
  accountId?: string;
  phoneNumberId?: string | null;
  accessToken?: string | null;
  businessAccountId?: string | null;
  provider: string;
  apiKey?: string | null;
  webhookSubscribed?: boolean | null;
  webhookLastCheckAt?: string | null;
};

type WebhookEnsureResult = {
  ok: boolean;
  skipped?: boolean;
  appStatus?: number;
  wabaStatus?: number;
  error?: string;
};

const WEBHOOK_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

function shouldRefreshWebhookSubscription(account: AccountCredentials): boolean {
  if (!account.businessAccountId || !account.accessToken) return false;
  // A janela vale também quando a inscrição falhou. Sem isso, toda conta com
  // webhook_subscribed = false paga 2-3 round-trips na Graph ANTES de cada
  // envio — e nunca sai desse estado, porque a retentativa segue falhando.
  if (!account.webhookLastCheckAt) return true;

  const lastCheck = new Date(account.webhookLastCheckAt).getTime();
  if (!Number.isFinite(lastCheck)) return true;

  return Date.now() - lastCheck > WEBHOOK_REFRESH_INTERVAL_MS;
}

async function getAccountCredentials(supabase: any, accountId?: string): Promise<AccountCredentials> {
  const baseSelect = "id, phone_number_id, access_token, business_account_id, provider, api_key, webhook_subscribed, webhook_last_check_at";

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
        webhookSubscribed: data.webhook_subscribed as boolean | null,
        webhookLastCheckAt: data.webhook_last_check_at as string | null,
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
      webhookSubscribed: defaultAcc.webhook_subscribed as boolean | null,
      webhookLastCheckAt: defaultAcc.webhook_last_check_at as string | null,
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
      webhookSubscribed: firstAcc.webhook_subscribed as boolean | null,
      webhookLastCheckAt: firstAcc.webhook_last_check_at as string | null,
    };
  }

  // Final fallback: env vars (always meta_cloud)
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  if (phoneNumberId && accessToken) return { phoneNumberId, accessToken, provider: "meta_cloud", apiKey: null };

  throw new Error("No WhatsApp account configured");
}

async function ensureWebhookSubscription(accessToken: string, businessAccountId?: string | null): Promise<WebhookEnsureResult> {
  if (!businessAccountId || !accessToken) return { ok: false, skipped: true, error: "missing credentials" };

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return { ok: false, skipped: true, error: "missing backend configuration" };
    }
    const settingsClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: tokenSetting } = await settingsClient
      .from("app_settings")
      .select("value")
      .eq("key", "whatsapp_verify_token")
      .maybeSingle();
    const verifyToken = tokenSetting?.value?.trim()
      || Deno.env.get("WHATSAPP_VERIFY_TOKEN")?.trim()
      || "prime_chat_verify_2026";
    const metaAppId = Deno.env.get("META_APP_ID");
    const metaAppSecret = Deno.env.get("META_APP_SECRET");

    // Ensure the Meta app itself is subscribed to WABA `messages` events. If this
    // app-level field is missing, WABA override succeeds but button replies never
    // POST to our webhook.
    if (metaAppId && metaAppSecret) {
      const appParams = new URLSearchParams();
      appParams.set("object", "whatsapp_business_account");
      appParams.set("callback_url", `${supabaseUrl}/functions/v1/whatsapp-cloud-webhook`);
      appParams.set("fields", "messages");
      appParams.set("verify_token", verifyToken);
      appParams.set("include_values", "true");
      appParams.set("access_token", `${metaAppId}|${metaAppSecret}`);

      const appSubRes = await fetch(`https://graph.facebook.com/v21.0/${metaAppId}/subscriptions`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: appParams.toString(),
      });
      const appSubText = await appSubRes.text();
      console.log("Meta app messages subscription check:", appSubRes.status, appSubText);

      if (!appSubRes.ok) {
        return { ok: false, appStatus: appSubRes.status, error: appSubText };
      }
    }

    const params = new URLSearchParams();
    params.set("override_callback_uri", `${supabaseUrl}/functions/v1/whatsapp-cloud-webhook`);
    params.set("verify_token", verifyToken);
    params.set("subscribed_fields", "messages");

    let subRes = await fetch(`https://graph.facebook.com/v21.0/${businessAccountId}/subscribed_apps`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    let subText = await subRes.text();
    console.log("WABA subscription check:", subRes.status, subText);

    if (!subRes.ok) {
      const fallback = new URLSearchParams();
      fallback.set("override_callback_uri", `${supabaseUrl}/functions/v1/whatsapp-cloud-webhook`);
      fallback.set("verify_token", verifyToken);
      subRes = await fetch(`https://graph.facebook.com/v21.0/${businessAccountId}/subscribed_apps`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: fallback.toString(),
      });
      subText = await subRes.text();
      console.log("WABA subscription fallback check:", subRes.status, subText);
    }

    if (!subRes.ok) {
      return { ok: false, wabaStatus: subRes.status, error: subText };
    }

    return { ok: true, wabaStatus: subRes.status };
  } catch (error) {
    console.error("Failed to ensure WABA subscription:", error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
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


// O WhatsApp Cloud API aceita só estes containers de áudio. Rotular errado faz
// o upload falhar com 131053, e aí o envio cai no `link` — que é justamente o
// que faz a mensagem chegar como "encaminhada".
const AUDIO_MIME_BY_EXT: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  aac: "audio/aac",
  amr: "audio/amr",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
};
const AUDIO_EXT_BY_MIME: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "audio/ogg": "ogg",
};

/**
 * Decide o mime a declarar no upload. Confia no content-type só quando ele é
 * um dos aceitos — `audio/webm` e `application/octet-stream` chegam bastante e
 * antes viravam "audio/ogg" no chute, o que a Meta rejeita.
 */
function resolveAudioMime(rawType: string, ext: string): { mime: string; fileExt: string } {
  const mime = AUDIO_EXT_BY_MIME[rawType]
    ? rawType
    : AUDIO_MIME_BY_EXT[ext] || "audio/ogg";
  return { mime, fileExt: AUDIO_EXT_BY_MIME[mime] || "ogg" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body_payload = await req.json();
    console.log("whatsapp-cloud-send received request:", JSON.stringify(body_payload));
    const { phone, message, lead_id, media_url, media_type, template_name, template_language, template_params, interactive_buttons, cta_url, account_id, file_name, reply_to_message_id } = body_payload;

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
      webhookSubscribed,
      webhookLastCheckAt,
    } = await getAccountCredentials(supabase, account_id);

    const isD360 = provider === "d360";
    const isEvolution = provider === "evolution";

    if (!isD360 && !isEvolution) {
      const accountSnapshot: AccountCredentials = {
        accountId: resolvedAccountId,
        phoneNumberId: PHONE_NUMBER_ID,
        accessToken: ACCESS_TOKEN,
        businessAccountId,
        provider,
        apiKey: D360_API_KEY,
        webhookSubscribed,
        webhookLastCheckAt,
      };

      if (shouldRefreshWebhookSubscription(accountSnapshot)) {
        const subscriptionResult = await ensureWebhookSubscription(ACCESS_TOKEN || "", businessAccountId);
        if (resolvedAccountId) {
          await supabase
            .from("whatsapp_accounts")
            .update({
              webhook_subscribed: subscriptionResult.ok ? true : webhookSubscribed,
              webhook_subscribed_at: subscriptionResult.ok ? new Date().toISOString() : undefined,
              webhook_last_check_at: new Date().toISOString(),
              webhook_last_status: subscriptionResult.ok
                ? "success (periodic refresh)"
                : `warning refresh failed: ${subscriptionResult.error || subscriptionResult.appStatus || subscriptionResult.wabaStatus || "unknown"}`,
            })
            .eq("id", resolvedAccountId);
        }
      }
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
          const firstName = varyName(leadData?.name);
          outgoingText = withUniqueSignature(
            String(templateContentRecord.content)
              .replace(/\{nome\}/gi, firstName)
              .replace(/\{\{1\}\}/g, firstName)
              .replace(/\{codigo\}/gi, "-")
          );
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
      // NOTE: Evolution QR-Code accounts accept sendButtons (201 PENDING) but WhatsApp
      // silently drops the resulting interactiveMessage — it never reaches the device.
      // To guarantee delivery on QR-Code instances we send a formatted text fallback.
      if (interactive_buttons && Array.isArray(interactive_buttons) && interactive_buttons.length > 0) {
        const bodyText = (outgoingText || "Escolha uma opção:").trim();
        const optionsList = interactive_buttons
          .slice(0, 10)
          .map((btn: any, i: number) => {
            const label = btn.title || `Opção ${i + 1}`;
            return btn.url ? `*${i + 1}*. ${label} → ${btn.url}` : `*${i + 1}*. ${label}`;
          })
          .join("\n");
        const fullText = `${bodyText}\n\n${optionsList}\n\n_Responda com o número da opção._`;
        endpoint = `${evoServerUrl}/message/sendText/${evoInstance}`;
        evoBody = { number: cleanPhone, text: fullText, linkPreview: true };
        logContent = `🔘 ${bodyText}`;
      } else if (cta_url) {
        const bodyText = (outgoingText || "Acesse o link abaixo:").trim();
        const display = cta_url.display_text || "Acessar";
        const fullText = `${bodyText}\n\n👉 *${display}*\n${cta_url.url}`;
        endpoint = `${evoServerUrl}/message/sendText/${evoInstance}`;
        evoBody = { number: cleanPhone, text: fullText, linkPreview: true };
        logContent = `🔗 ${bodyText}`;
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
          // Use custom file_name when provided (preserves user-defined PDF name shown on WhatsApp)
          let fileName: string;
          if (typeof file_name === "string" && file_name.trim()) {
            const cleanName = file_name.trim();
            // Ensure correct extension
            fileName = cleanName.toLowerCase().endsWith(`.${ext}`) ? cleanName : `${cleanName}.${ext}`;
          } else {
            fileName = media_type === "document" ? `arquivo.${ext}` : `media.${ext}`;
          }
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

    // Meta Cloud only allows free-form messages after the customer has replied
    // to this specific conversation recently. Templates are still allowed outside
    // the 24h window, so block only non-template sends before Meta accepts and
    // later fails them asynchronously with code 131047.
    if (!template_name && lead_id && !isD360) {
      const { data: leadWindow } = await supabase
        .from("leads")
        .select("last_inbound_at, phone, user_id")
        .eq("id", lead_id)
        .maybeSingle();

      // Duplicate leads with the same phone are allowed, so the reply may have
      // landed on a sibling lead row. Consider the most recent inbound across
      // every lead that shares this phone for the same user.
      let lastInboundMs = leadWindow?.last_inbound_at ? new Date(leadWindow.last_inbound_at).getTime() : NaN;

      const digits = String(leadWindow?.phone || phone || "").replace(/\D/g, "");
      if (digits) {
        const variants = new Set<string>([digits]);
        if (digits.startsWith("55") && digits.length === 13) variants.add(digits.slice(0, 4) + digits.slice(5));
        if (digits.startsWith("55") && digits.length === 12) variants.add(digits.slice(0, 4) + "9" + digits.slice(4));

        let siblingQuery = supabase
          .from("leads")
          .select("last_inbound_at")
          .in("phone", Array.from(variants))
          .not("last_inbound_at", "is", null)
          .order("last_inbound_at", { ascending: false })
          .limit(1);

        if (leadWindow?.user_id) siblingQuery = siblingQuery.eq("user_id", leadWindow.user_id);

        const { data: sibling } = await siblingQuery.maybeSingle();
        const siblingMs = sibling?.last_inbound_at ? new Date(sibling.last_inbound_at).getTime() : NaN;
        if (Number.isFinite(siblingMs) && (!Number.isFinite(lastInboundMs) || siblingMs > lastInboundMs)) {
          lastInboundMs = siblingMs;
        }
      }

      const insideWindow = Number.isFinite(lastInboundMs) && Date.now() - lastInboundMs <= 24 * 60 * 60 * 1000;

      if (!insideWindow) {
        const friendlyMsg = "Esse contato está fora da janela de 24h da Meta. Envie um template aprovado para reabrir a conversa.";
        await supabase.from("chat_messages").insert({
          lead_id,
          direction: "outbound",
          content: `❌ ${friendlyMsg}`,
          media_type: media_type || null,
          media_url: media_url || null,
          status: "failed",
          account_id: account_id || resolvedAccountId || null,
        });

        return new Response(
          JSON.stringify({ error: friendlyMsg, wa_error: { code: 131047, title: "Re-engagement message" } }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

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
      const leadFirstName = varyName(leadData?.name);

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

      const components: any[] = [];

      // --- Header (media) support -------------------------------------------------
      // Meta rejects the send with #132012 when the created template has a media
      // header but no matching header component is sent. Discover the header format
      // from the Graph API and attach the media (explicit media_url or the template's
      // own example asset).
      let headerFormat: string | null = null;
      let headerExampleUrl: string | null = null;
      if (!isD360 && businessAccountId && ACCESS_TOKEN) {
        try {
          const tRes = await fetch(
            `https://graph.facebook.com/v21.0/${businessAccountId}/message_templates?name=${encodeURIComponent(template_name)}&limit=20&fields=name,language,status,components`,
            { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } },
          );
          const tJson = await tRes.json().catch(() => ({}));
          const lang = (resolvedLanguage || "pt_BR").toLowerCase();
          const match = (tJson?.data || []).find((t: any) =>
            String(t.name).toLowerCase() === String(template_name).toLowerCase() && String(t.language).toLowerCase() === lang
          ) || (tJson?.data || []).find((t: any) =>
            String(t.name).toLowerCase() === String(template_name).toLowerCase()
          ) || (tJson?.data || [])[0];
          const headerComp = (match?.components || []).find((c: any) => c.type === "HEADER");
          if (headerComp && headerComp.format && headerComp.format !== "TEXT") {
            headerFormat = String(headerComp.format).toLowerCase(); // image | video | document
            const ex = headerComp.example;
            headerExampleUrl = ex?.header_handle?.[0] || ex?.header_url?.[0] || null;
          }
        } catch (e) {
          console.error("Falha ao inspecionar header do template:", e);
        }
      }

      if (headerFormat) {
        let headerLink = (media_url && (!media_type || media_type === headerFormat)) ? media_url : headerExampleUrl;
        if (!headerLink) {
          return new Response(
            JSON.stringify({ error: `Template "${template_name}" exige um cabeçalho do tipo ${headerFormat.toUpperCase()}. Informe media_url com esse tipo de mídia.` }),
            { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        // Meta's own signed CDN links (template example media) often fail to be
        // re-downloaded by the send API — mirror to a stable public URL.
        headerLink = await resolveTemplateHeaderLink(
          supabase,
          headerLink,
          `${businessAccountId}_${template_name}_${resolvedLanguage || "pt_BR"}`,
          headerFormat as "image" | "video" | "document",
        );
        components.push({
          type: "header",
          parameters: [{ type: headerFormat, [headerFormat]: { link: headerLink } }],
        });
      }


      if (finalParams && Array.isArray(finalParams) && finalParams.length > 0) {
        const fallbackName = leadFirstName || "amigo(a)";
        const rawParams = finalParams
          .map((p: any) => typeof p === "string" ? { type: "text", text: p || fallbackName } : { type: "text", text: p.text || fallbackName })
          .map((p: any) => ({
            ...p,
            text: p.text.replace(/\{\{\d+\}\}/g, fallbackName).trim() || fallbackName,
          }))
          .filter((p: any) => p.text && p.text.trim() !== "");
        // Append unique invisible signature ONLY to the last param so each
        // outgoing template message has a unique payload (anti-fingerprint).
        const mappedParams = rawParams.map((p: any, idx: number) =>
          idx === rawParams.length - 1 ? { ...p, text: withUniqueSignature(p.text) } : p
        );
        if (mappedParams.length > 0) {
          components.push({ type: "body", parameters: mappedParams });
        }
      }
      if (components.length > 0) {
        templateBody.template.components = components;
      }
      body = templateBody;

    } else if (media_url && media_type) {
      if (media_type === "image") {
        body = { messaging_product: "whatsapp", to: cleanPhone, type: "image", image: { link: media_url, caption: message || undefined } };
      } else if (media_type === "video") {
        body = { messaging_product: "whatsapp", to: cleanPhone, type: "video", video: { link: media_url, caption: message || undefined } };
      } else if (media_type === "audio") {
        // Para o WhatsApp exibir como ÁUDIO GRAVADO (voice note), a mídia precisa
        // ser OGG/Opus e o payload precisa declarar explicitamente `voice: true`.
        // O upload por `id` evita depender de um download posterior da URL.
        let audioPayload: Record<string, string> | null = null;

        if (isD360) {
          audioPayload = { link: media_url };
        } else {
          let lastErr = "";
          for (let attempt = 1; attempt <= 3 && !audioPayload; attempt++) {
            try {
              const fileRes = await fetch(media_url);
              if (!fileRes.ok) throw new Error(`download ${fileRes.status}`);
              const rawType = (fileRes.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
              const ext = (media_url.split("?")[0].split(".").pop() || "").toLowerCase();
              const { mime, fileExt } = resolveAudioMime(rawType, ext);
              // Opus só é reconhecido como voice note quando o codec é declarado.
              const uploadMime = mime === "audio/ogg" ? "audio/ogg; codecs=opus" : mime;
              const blob = new Blob([await fileRes.arrayBuffer()], { type: uploadMime });
              const form = new FormData();
              form.append("messaging_product", "whatsapp");
              form.append("type", uploadMime);
              form.append("file", blob, `audio.${fileExt}`);
              const upRes = await fetch(
                `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/media`,
                { method: "POST", headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }, body: form },
              );
              const upJson = await upRes.json().catch(() => null);
              if (upRes.ok && upJson?.id) {
                audioPayload = { id: upJson.id };
              } else {
                lastErr = `status=${upRes.status} mime=${uploadMime} meta=${JSON.stringify(upJson?.error || upJson)}`;
                console.error(`Upload de áudio falhou (tentativa ${attempt}/3): ${lastErr}`);
              }
            } catch (e) {
              lastErr = String(e);
              console.error(`Erro ao subir áudio (tentativa ${attempt}/3):`, e);
            }
          }

          if (!audioPayload) {
            // Não caímos mais no `link`: chegaria como "encaminhada".
            // Falhamos para o chamador (fluxo) poder reenviar.
            return new Response(
              JSON.stringify({ error: `Falha ao subir áudio para a Meta: ${lastErr}` }),
              { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
        }

        body = {
          messaging_product: "whatsapp",
          to: cleanPhone,
          type: "audio",
          audio: { ...audioPayload, voice: true },
        };


      } else {
        // Preserva o nome/extensão original do arquivo (qualquer tipo, não só PDF).
        const rawName = typeof file_name === "string" ? file_name.trim() : "";
        const hasExt = /\.[a-z0-9]{2,5}$/i.test(rawName);
        const urlExt = (media_url.split("?")[0].split(".").pop() || "").toLowerCase();
        const docFileName = rawName
          ? (hasExt ? rawName : (urlExt ? `${rawName}.${urlExt}` : rawName))
          : undefined;
        body = { messaging_product: "whatsapp", to: cleanPhone, type: "document", document: { link: media_url, caption: message || undefined, filename: docFileName } };
      }
    } else if (interactive_buttons && Array.isArray(interactive_buttons) && interactive_buttons.length > 0) {
      const btnBodyRaw = (message || "Escolha uma opção:").trim();
      const btnBodyText = btnBodyRaw.length > 1024 ? btnBodyRaw.substring(0, 1021) + "..." : btnBodyRaw;
      if (btnBodyRaw.length > 1024) {
        console.warn(`interactive_buttons body truncated from ${btnBodyRaw.length} to 1024 chars for ${cleanPhone}`);
      }
      body = {
        messaging_product: "whatsapp", to: cleanPhone, type: "interactive",
        interactive: {
          type: "button",
          body: { text: btnBodyText },
          action: {
            buttons: interactive_buttons.slice(0, 3).map((btn: any, i: number) => ({
              type: "reply", reply: { id: btn.id || `btn_${i}`, title: (btn.title || `Opção ${i + 1}`).substring(0, 20) },
            })),
          },
        },
      };
    } else if (cta_url) {
      const ctaBodyRaw = (message || "Acesse o link abaixo:").trim();
      const ctaBodyText = ctaBodyRaw.length > 1024 ? ctaBodyRaw.substring(0, 1021) + "..." : ctaBodyRaw;
      if (ctaBodyRaw.length > 1024) {
        console.warn(`cta_url body truncated from ${ctaBodyRaw.length} to 1024 chars for ${cleanPhone}`);
      }
      body = {
        messaging_product: "whatsapp", to: cleanPhone, type: "interactive",
        interactive: {
          type: "cta_url",
          body: { text: ctaBodyText },
          action: { name: "cta_url", parameters: { display_text: (cta_url.display_text || "Acessar").substring(0, 20), url: cta_url.url } },
        },
      };
    } else {
      body = { messaging_product: "whatsapp", to: cleanPhone, type: "text", text: { body: withUniqueSignature(message) } };
    }

    // Resposta citada (reply): a Meta aceita `context.message_id` com o ID (wamid)
    // da mensagem original. Só aplicamos em mensagens não-template, pois templates
    // de marketing não suportam contexto.
    if (reply_to_message_id && typeof reply_to_message_id === "string" && !template_name) {
      body.context = { message_id: reply_to_message_id };
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

        // Regras de Kanban que reagem a falhas de envio.
        const { data: failLead } = await supabase
          .from("leads").select("user_id").eq("id", lead_id).maybeSingle();
        await applyStageAutomations(supabase, {
          userId: failLead?.user_id ?? null,
          leadId: lead_id,
          trigger: "send_failed",
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

      const initialStatus = waData.messages?.[0]?.message_status === "accepted" ? "accepted" : "sent";

      // Snapshot da mensagem citada para exibir no histórico do chat.
      let quotedMessage: Record<string, unknown> | null = null;
      if (reply_to_message_id && typeof reply_to_message_id === "string") {
        const { data: quoted } = await supabase
          .from("chat_messages")
          .select("content, direction, media_type")
          .eq("zapi_message_id", reply_to_message_id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (quoted) {
          quotedMessage = {
            content: quoted.content,
            direction: quoted.direction,
            media_type: quoted.media_type,
          };
        }
      }

      await supabase.from("chat_messages").insert({
        lead_id, direction: "outbound", content: contentText,
        media_type: media_type || null, media_url: media_url || null,
        zapi_message_id: waMessageId, status: initialStatus,
        account_id: account_id || resolvedAccountId || null,
        quoted_message: quotedMessage,
      });

      const { error: leadUpdateError } = await supabase
        .from("leads")
        .update({ last_outbound_at: activityAt, updated_at: activityAt })
        .eq("id", lead_id);

      if (leadUpdateError) {
        console.error("Failed to update lead outbound activity:", leadUpdateError);
      }

      // Regras de Kanban que reagem a mensagens enviadas.
      const { data: sentLead } = await supabase
        .from("leads").select("user_id").eq("id", lead_id).maybeSingle();
      await applyStageAutomations(supabase, {
        userId: sentLead?.user_id ?? null,
        leadId: lead_id,
        trigger: "outbound_message",
        messageText: contentText,
      });
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
