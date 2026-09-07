// Meta Conversions API — client interno, fase 1 (só WhatsApp / ctwa_clid).
// Roda em paralelo à integração com a Metrito (metrito.ts) — não a substitui.
//
// HARD RULE: nada aqui pode lançar exceção nem bloquear o caminho crítico do
// caller. Sempre chamado via runBestEffort (metrito.ts). Falha vira log +
// `sent_to_capi = false`, nunca uma mensagem ou webhook perdido.
//
// Credenciais: cada conta pode cadastrar as suas em `capi_settings`. Quem não
// cadastrou cai nos secrets globais:
//   META_PIXEL_ID, META_CAPI_TOKEN, META_CAPI_TEST_EVENT_CODE (opcional, só
//   durante a validação no Test Events).
// Sem credencial em nenhum dos dois níveis, o envio fica inerte (loga e
// retorna false). Ver resolveCapiCreds.

import { pickCapiCreds } from "./capi-map.mjs";
export { runBestEffort } from "./metrito.ts";

const GRAPH_VERSION = "v21.0";
const TIMEOUT_MS = 5000;

export interface CapiCreds {
  pixelId: string | null;
  accessToken: string | null;
  testEventCode: string | null;
}

export function envCapiCreds(): CapiCreds {
  return {
    pixelId: Deno.env.get("META_PIXEL_ID") || null,
    accessToken: Deno.env.get("META_CAPI_TOKEN") || null,
    testEventCode: Deno.env.get("META_CAPI_TEST_EVENT_CODE") || null,
  };
}

/**
 * Credenciais do dono `ownerId`, caindo nos secrets globais quando ele não
 * cadastrou nenhuma. Tudo ou nada de propósito (ver capi-map.mjs): campo em
 * branco do cadastro próprio não herda do global — misturar pixel de um
 * cliente com token de outro manda o dado dele pro painel errado.
 */
export async function resolveCapiCreds(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  ownerId?: string | null,
): Promise<CapiCreds> {
  const env = envCapiCreds();
  if (!ownerId) return env;
  try {
    const { data } = await supabase
      .from("capi_settings")
      .select("pixel_id, access_token, test_event_code")
      .eq("owner_id", ownerId)
      .maybeSingle();
    return pickCapiCreds(
      { pixelId: data?.pixel_id, accessToken: data?.access_token, testEventCode: data?.test_event_code },
      env,
    );
  } catch (e) {
    console.log("[capi] creds lookup failed, using env: " + ((e as Error)?.message || e));
    return env;
  }
}

/** SHA-256 hex — a Meta exige telefone/e-mail sempre hasheados assim. */
export async function sha256(value: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface CapiEventInput {
  ownerId: string | null;
  leadId?: string | null;
  eventName: "Lead" | "Purchase";
  /** Determinístico — mesmo evento reprocessado não duplica no Meta nem aqui. */
  eventId: string;
  phoneHash?: string | null;
  ctwaClid?: string | null;
  value?: number;
  currency?: string;
}

/**
 * Envia o evento pro Meta CAPI e registra o resultado em `attribution_events`
 * (dedup local + auditoria). Nunca lança — falha de rede, falta de
 * credencial ou erro da Meta tudo vira `false` + log.
 */
export async function sendCapiEvent(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  input: CapiEventInput,
): Promise<boolean> {
  const creds = await resolveCapiCreds(supabase, input.ownerId);
  if (!creds.accessToken || !creds.pixelId) {
    console.log("[capi] sem pixel/token (conta nem global) — evento ignorado: " + input.eventName);
    return false;
  }

  const userData: Record<string, unknown> = {};
  if (input.phoneHash) userData.ph = [input.phoneHash];
  if (input.ctwaClid) userData.ctwa_clid = input.ctwaClid;

  const eventPayload: Record<string, unknown> = {
    event_name: input.eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: input.eventId,
    action_source: "business_messaging",
    messaging_channel: "whatsapp",
    user_data: userData,
  };
  if (input.value != null) {
    eventPayload.custom_data = { value: input.value, currency: input.currency || "BRL" };
  }

  const body: Record<string, unknown> = { data: [eventPayload] };
  if (creds.testEventCode) body.test_event_code = creds.testEventCode;

  let ok = false;
  // deno-lint-ignore no-explicit-any
  let responseBody: any = null;
  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${creds.pixelId}/events?access_token=${creds.accessToken}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    responseBody = await res.json().catch(() => ({}));
    ok = res.ok;
    if (!ok) {
      console.log(
        "[capi] event " + input.eventName + " failed status=" + res.status +
          " body=" + JSON.stringify(responseBody).slice(0, 300),
      );
    } else {
      console.log("[capi] event " + input.eventName + " ok events_received=" + (responseBody?.events_received ?? "-"));
    }
  } catch (e) {
    responseBody = { error: (e as Error)?.message || String(e) };
    console.log("[capi] event error: " + responseBody.error);
  }

  try {
    await supabase.from("attribution_events").upsert(
      {
        owner_id: input.ownerId,
        lead_id: input.leadId ?? null,
        event_name: input.eventName,
        event_id: input.eventId,
        action_source: "business_messaging",
        value: input.value ?? null,
        currency: input.currency || "BRL",
        sent_to_capi: ok,
        capi_response: responseBody,
      },
      { onConflict: "owner_id,event_id,event_name" },
    );
  } catch (e) {
    console.log("[capi] failed to log attribution_events: " + ((e as Error)?.message || e));
  }

  return ok;
}
