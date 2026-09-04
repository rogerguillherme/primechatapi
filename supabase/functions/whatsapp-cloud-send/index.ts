import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { applyStageAutomations } from "../_shared/stage-automations.ts";
import { resolveTemplateHeaderLink } from "../_shared/template-media.ts";
import { evoErrorMessage } from "../_shared/evo-error.mjs";
import { videoRecusadoPelaUrl } from "../_shared/media-limits.mjs";
import { telefoneImplausivel } from "../_shared/phone.mjs";
import { bloqueioDeConta } from "../_shared/meta-block.mjs";
import { identificarChamador } from "../_shared/caller.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Resolve as credenciais do app Meta usado pela conta.
 */
function resolveAppCredentials(accountAppId?: string | null) {
  const crmAppId = Deno.env.get("CRM_APP_ID");
  const crmAppSecret = Deno.env.get("CRM_APP_SECRET");
  if (accountAppId && crmAppId && String(accountAppId) === String(crmAppId)) {
    return { appId: crmAppId, appSecret: crmAppSecret ?? null };
  }
  return {
    appId: Deno.env.get("META_APP_ID") ?? null,
    appSecret: Deno.env.get("META_APP_SECRET") ?? null
  };
}

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
  blockedAt?: string | null;
  blockedReason?: string | null;
  appId?: string | null;
  appSecret?: string | null;
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
  if (!account.webhookLastCheckAt) return true;

  const lastCheck = new Date(account.webhookLastCheckAt).getTime();
  if (!Number.isFinite(lastCheck)) return true;

  return Date.now() - lastCheck > WEBHOOK_REFRESH_INTERVAL_MS;
}

async function getAccountCredentials(
  supabase: any,
  accountId?: string,
  ownerUserId?: string | null,
): Promise<AccountCredentials> {
  const baseSelect = "id, user_id, is_default, phone_number_id, access_token, business_account_id, provider, api_key, webhook_subscribed, webhook_last_check_at, blocked_at, blocked_reason, app_id, app_secret";

  const toCreds = (data: any): AccountCredentials => ({
    accountId: data.id,
    phoneNumberId: data.phone_number_id,
    accessToken: data.access_token,
    businessAccountId: data.business_account_id,
    provider: (data.provider as string) || "meta_cloud",
    apiKey: data.api_key as string | null,
    webhookSubscribed: data.webhook_subscribed as boolean | null,
    webhookLastCheckAt: data.webhook_last_check_at as string | null,
    blockedAt: (data.blocked_at as string | null) ?? null,
    blockedReason: (data.blocked_reason as string | null) ?? null,
    appId: data.app_id,
    appSecret: data.app_secret,
  });

  if (accountId) {
    let q = supabase.from("whatsapp_accounts").select(baseSelect).eq("id", accountId);
    if (ownerUserId) q = q.eq("user_id", ownerUserId);
    const { data, error } = await q.maybeSingle();
    if (error) throw new Error(`Failed to fetch account: ${error.message}`);
    if (data) return toCreds(data);
  }

  if (ownerUserId) {
    const { data: owned } = await supabase
      .from("whatsapp_accounts")
      .select(baseSelect)
      .eq("user_id", ownerUserId)
      .order("is_default", { ascending: false })
      .order("created_at")
      .limit(50);

    const list: any[] = owned || [];
    if (list.length) {
      const preferred =
        list.find((a) => a.is_default && (a.provider || "meta_cloud") === "meta_cloud") ||
        list.find((a) => (a.provider || "meta_cloud") === "meta_cloud") ||
        list[0];
      return toCreds(preferred);
    }
  }

  if (!ownerUserId) {
    const { data: defaultAcc } = await supabase
      .from("whatsapp_accounts")
      .select(baseSelect)
      .eq("is_default", true)
      .maybeSingle();
    if (defaultAcc) return toCreds(defaultAcc);

    const { data: firstAcc } = await supabase
      .from("whatsapp_accounts")
      .select(baseSelect)
      .order("created_at")
      .limit(1)
      .maybeSingle();
    if (firstAcc) return toCreds(firstAcc);
  }

  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  if (phoneNumberId && accessToken) return { phoneNumberId, accessToken, provider: "meta_cloud", apiKey: null };

  throw new Error("No WhatsApp account configured");
}

async function ensureWebhookSubscription(
  accessToken: string,
  businessAccountId?: string | null,
  metaAppId?: string | null,
  metaAppSecret?: string | null
): Promise<WebhookEnsureResult> {
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

    // Use passed credentials or fall back to globals
    const appId = metaAppId || Deno.env.get("META_APP_ID");
    const appSecret = metaAppSecret || Deno.env.get("META_APP_SECRET");

    if (appId && appSecret) {
      const appParams = new URLSearchParams();
      appParams.set("object", "whatsapp_business_account");
      appParams.set("callback_url", `${supabaseUrl}/functions/v1/whatsapp-cloud-webhook`);
      appParams.set("fields", "messages");
      appParams.set("verify_token", verifyToken);
      appParams.set("include_values", "true");
      appParams.set("access_token", `${appId}|${appSecret}`);

      const appSubRes = await fetch(`https://graph.facebook.com/v21.0/${appId}/subscriptions`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: appParams.toString(),
      });
      const appSubText = await appSubRes.text();
      console.log(`Meta app ${appId} messages subscription check:`, appSubRes.status, appSubText);

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

// ... remaining file content (omitted for brevity here but I will include it in the real cat command)
