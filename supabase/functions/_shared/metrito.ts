// Metrito integration — best-effort client.
//
// HARD RULE: nothing here may throw or block the caller's critical path.
// Every function swallows its own errors and returns null/false. Prime Chat
// processes thousands of messages a day; Metrito being slow or down must never
// cost a message, a lead or an order.
//
// Secrets (set in Supabase, never in source):
//   METRITO_API_KEY     — mtk_live_... (scopes tracking:write, data:read)
//   METRITO_PROJECT_ID  — default project for /v3/query
//   METRITO_GENERIC_KEY — ?k= key for the generic transaction webhook
// A missing secret makes the matching feature inert (logs, returns null).

import { mapHublaStatusToMetrito, toCents } from "./metrito-map.mjs";

export { mapHublaStatusToMetrito, toCents };

const BASE = "https://api.metrito.com";
// Short leash: these calls run in the background, but a hung socket still ties
// up the isolate until it is recycled.
const TIMEOUT_MS = 5000;

export function metritoApiKey(): string | null {
  return Deno.env.get("METRITO_API_KEY") || null;
}

export function metritoGenericKey(): string | null {
  return Deno.env.get("METRITO_GENERIC_KEY") || null;
}

export function metritoProjectId(): string | null {
  return Deno.env.get("METRITO_PROJECT_ID") || null;
}

async function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ ok: boolean; status: number; body: any }> {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const parsed = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body: parsed };
}

export interface MetritoUtm {
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
}

export interface MetritoAttribution extends MetritoUtm {
  tracking_link_id?: string | null;
  decoded_id?: string | null;
  decoded_at: string;
}

/**
 * Decodes the invisible tracking payload Metrito embeds in a WhatsApp message.
 * Returns null when there is no tracking, no API key, or the call fails.
 * Only worth calling on a lead's FIRST message — every other message costs a
 * round trip for a guaranteed null.
 */
export async function decodeWhatsAppText(text: string): Promise<MetritoAttribution | null> {
  const key = metritoApiKey();
  if (!key || !text) return null;
  try {
    const { ok, status, body } = await post(
      "/v3/tracking/messages/decode",
      { messages: [{ text }] },
      { Authorization: "Bearer " + key },
    );
    if (!ok) {
      console.log("[metrito] decode failed status=" + status);
      return null;
    }
    const first = body?.messages?.[0];
    const params = first?.params;
    // No tracking in the message: Metrito returns nulls, not an error.
    if (!params && !first?.tracking_link_id) return null;
    return {
      utm_source: params?.utm_source ?? null,
      utm_medium: params?.utm_medium ?? null,
      utm_campaign: params?.utm_campaign ?? null,
      utm_content: params?.utm_content ?? null,
      utm_term: params?.utm_term ?? null,
      tracking_link_id: first?.tracking_link_id ?? null,
      decoded_id: first?.decoded_id ?? null,
      decoded_at: new Date().toISOString(),
    };
  } catch (e) {
    console.log("[metrito] decode error: " + ((e as Error)?.message || e));
    return null;
  }
}

export interface MetritoEventInput {
  /** Internal event name, e.g. "whatsapp_lead". */
  name: string;
  /** Facebook standard event: "Lead" | "Purchase" | "Contact" ... */
  facebookName: string;
  /** "business_messaging" for WhatsApp, "website" otherwise. */
  facebookSourceKey?: "business_messaging" | "website";
  sourceKey?: "api" | "whatsapp" | "website";
  /** Stable id (message id / order id) — deduped by Metrito for 24h. */
  idempotencyKey: string;
  eventId?: string;
  eventTime?: number;
  value?: number;
  currency?: string;
  lead?: { email?: string | null; phone?: string | null; name?: string | null; doc?: string | null };
  utm?: MetritoUtm | null;
}

/** Fire-and-forget event to POST /v3/tracking/events. Never throws. */
export async function sendMetritoEvent(input: MetritoEventInput): Promise<boolean> {
  const key = metritoApiKey();
  if (!key) {
    console.log("[metrito] METRITO_API_KEY not set — event skipped");
    return false;
  }
  try {
    const lead = Object.fromEntries(
      Object.entries(input.lead || {}).filter(([, v]) => v != null && v !== ""),
    );
    const utm = Object.fromEntries(
      Object.entries(input.utm || {}).filter(
        ([k, v]) => k.startsWith("utm_") && v != null && v !== "",
      ),
    );
    const payload: Record<string, unknown> = {
      config: {
        name: input.name,
        facebook: {
          name: input.facebookName,
          sourceKey: input.facebookSourceKey || "business_messaging",
        },
      },
      sourceKey: input.sourceKey || "whatsapp",
      event_id: input.eventId || input.idempotencyKey,
      event_time: input.eventTime || Math.floor(Date.now() / 1000),
    };
    if (input.value != null) {
      payload.data = { value: input.value, currency: input.currency || "BRL" };
    }
    if (Object.keys(lead).length) payload.lead = lead;
    if (Object.keys(utm).length) payload.utm = utm;

    const { ok, status, body } = await post("/v3/tracking/events", payload, {
      Authorization: "Bearer " + key,
      "Idempotency-Key": input.idempotencyKey,
    });
    if (!ok) {
      console.log(
        "[metrito] event " + input.facebookName + " failed status=" + status +
          " body=" + JSON.stringify(body).slice(0, 300),
      );
      return false;
    }
    console.log("[metrito] event " + input.facebookName + " ok event_id=" + (body?.event_id || "-"));
    return true;
  } catch (e) {
    console.log("[metrito] event error: " + ((e as Error)?.message || e));
    return false;
  }
}

export interface MetritoTransactionInput {
  id: string;
  /** Prime Chat / Hubla status — mapped to Metrito's enum internally. */
  status: string;
  /** Amount in REAIS. Converted to integer cents here. */
  amount: number;
  currency?: string;
  createdAt?: string;
  updatedAt?: string;
  customer?: { name?: string | null; email?: string | null; phone?: string | null };
  products?: Array<{ id?: string | null; name?: string | null }>;
  payment?: { method?: string | null; installments?: number | null };
  utm?: MetritoUtm | null;
}

/**
 * Reports a transaction to POST /v2/tracking/generic?k=... .
 * Monetary values go out as INTEGER CENTS — see toCents / test_metrito.mjs.
 */
export async function sendMetritoTransaction(input: MetritoTransactionInput): Promise<boolean> {
  const k = metritoGenericKey();
  if (!k) {
    console.log("[metrito] METRITO_GENERIC_KEY not set — transaction skipped");
    return false;
  }
  try {
    const now = new Date().toISOString();
    const currency = (input.currency || "BRL").toUpperCase();
    const cents = toCents(input.amount);
    const transaction: Record<string, unknown> = {
      id: String(input.id),
      status: mapHublaStatusToMetrito(input.status),
      // Prime Chat does not track affiliate commission; Metrito requires the
      // commission_* fields, so the full transaction value is reported there.
      commission_currency: currency,
      commission_value: cents,
      value: cents,
      currency,
      created_at: input.createdAt || now,
      updated_at: input.updatedAt || now,
    };
    const customer = Object.fromEntries(
      Object.entries(input.customer || {}).filter(([, v]) => v != null && v !== ""),
    );
    if (Object.keys(customer).length) transaction.customer = customer;
    if (input.products?.length) transaction.products = input.products;
    if (input.payment?.method) transaction.payment = input.payment;

    const body: Record<string, unknown> = { transaction };
    const utm = input.utm;
    if (utm && (utm.utm_source || utm.utm_campaign || utm.utm_medium)) {
      body.utm = {
        source: utm.utm_source ?? undefined,
        medium: utm.utm_medium ?? undefined,
        campaign: utm.utm_campaign ?? undefined,
      };
    }

    const res = await post("/v2/tracking/generic?k=" + encodeURIComponent(k), body);
    if (!res.ok) {
      console.log(
        "[metrito] transaction " + input.id + " failed status=" + res.status +
          " body=" + JSON.stringify(res.body).slice(0, 300),
      );
      return false;
    }
    console.log(
      "[metrito] transaction " + input.id + " ok (" + transaction.status + ", " + cents + " cents)",
    );
    return true;
  } catch (e) {
    console.log("[metrito] transaction error: " + ((e as Error)?.message || e));
    return false;
  }
}

/**
 * Runs work off the request's critical path. Uses EdgeRuntime.waitUntil so the
 * isolate is kept alive until the work finishes, without the handler awaiting it.
 */
export function runBestEffort(work: () => Promise<unknown>): void {
  const p = (async () => {
    try {
      await work();
    } catch (e) {
      console.log("[metrito] background task error: " + ((e as Error)?.message || e));
    }
  })();
  try {
    // @ts-ignore EdgeRuntime is provided by Supabase Edge Functions
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(p);
    }
  } catch {
    /* best effort by definition */
  }
}
