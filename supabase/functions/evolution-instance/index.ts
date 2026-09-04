// Evolution API – Instance management (create, connect/QR, status, logout, delete)
// Multi-tenant: validates Supabase JWT and operates only on accounts owned by the user.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface EvoCreds {
  serverUrl: string;
  apiKey: string;
  instance: string;
  accountId: string;
}

async function evoFetch(
  creds: EvoCreds,
  path: string,
  init: RequestInit = {},
) {
  const url = `${creds.serverUrl.replace(/\/+$/, "")}${path}`;
  const headers = {
    "Content-Type": "application/json",
    apikey: creds.apiKey,
    ...(init.headers || {}),
  };
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { ok: res.ok, status: res.status, body };
}

// ============= Backoff exponencial para QR / connect =============
// Persistido em app_settings com chave "evo_qr_backoff:<account_id>"
// Sequência: 30s, 1m, 2m, 4m, 8m, 15m, 30m, 60m (cap)
// "QR code limit reached" detectado → pula direto para 15m e marca cooldown longo.
const BACKOFF_STEPS_SEC = [30, 60, 120, 240, 480, 900, 1800, 3600];
const QR_LIMIT_STEP_INDEX = 5; // 15 minutos quando bate o limite

interface BackoffState {
  attempts: number;
  next_allowed_at: string; // ISO
  last_reason?: string;
}

async function getBackoffState(admin: any, key: string): Promise<BackoffState | null> {
  const { data } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (!data?.value) return null;
  try { return JSON.parse(data.value) as BackoffState; } catch { return null; }
}

async function setBackoffState(admin: any, key: string, state: BackoffState) {
  await admin
    .from("app_settings")
    .upsert({ key, value: JSON.stringify(state), updated_at: new Date().toISOString() }, { onConflict: "key" });
}

async function clearBackoffState(admin: any, key: string) {
  await admin.from("app_settings").delete().eq("key", key);
}

function computeNextDelaySec(attempts: number, hitQrLimit: boolean): number {
  if (hitQrLimit) {
    return BACKOFF_STEPS_SEC[Math.max(QR_LIMIT_STEP_INDEX, attempts)] ??
      BACKOFF_STEPS_SEC[BACKOFF_STEPS_SEC.length - 1];
  }
  return BACKOFF_STEPS_SEC[Math.min(attempts, BACKOFF_STEPS_SEC.length - 1)];
}

/** Retorna { allowed, retry_after_sec, state }. Se allowed=true, NÃO incrementa ainda. */
async function checkBackoff(admin: any, accountId: string) {
  const key = `evo_qr_backoff:${accountId}`;
  const state = await getBackoffState(admin, key);
  if (!state) return { allowed: true, retry_after_sec: 0, state: null, key };
  const now = Date.now();
  const next = new Date(state.next_allowed_at).getTime();
  if (now >= next) return { allowed: true, retry_after_sec: 0, state, key };
  return {
    allowed: false,
    retry_after_sec: Math.ceil((next - now) / 1000),
    state,
    key,
  };
}

/** Registra uma tentativa (sucesso ou falha) atualizando o backoff. */
async function recordAttempt(
  admin: any,
  key: string,
  prev: BackoffState | null,
  outcome: "success" | "failed" | "qr_limit",
  reason?: string,
) {
  if (outcome === "success") {
    await clearBackoffState(admin, key);
    return;
  }
  const attempts = (prev?.attempts ?? 0) + 1;
  const delaySec = computeNextDelaySec(attempts - 1, outcome === "qr_limit");
  const next = new Date(Date.now() + delaySec * 1000).toISOString();
  await setBackoffState(admin, key, {
    attempts,
    next_allowed_at: next,
    last_reason: reason || outcome,
  });
}

function detectQrLimit(body: any): boolean {
  const s = JSON.stringify(body || "").toLowerCase();
  return s.includes("qr code limit") || s.includes("qrcode limit") || s.includes("please login again");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims?.sub) {
      console.error("Auth failed:", claimsErr);
      return json({ error: "Unauthorized" }, 401);
    }
    const userId = claimsData.claims.sub as string;

    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const action: string = body.action || "";

    // --------- Create-and-connect: cria account no DB + cria instance + retorna QR ---------
    if (action === "create_and_connect") {
      const {
        name,
        serverUrl,
        apiKey,
        instance,
        is_default = false,
      } = body;

      if (!name) {
        return json({ error: "name é obrigatório" }, 400);
      }

      // Fallback automático para secrets do backend
      const envServer = Deno.env.get("EVOLUTION_SERVER_URL") || "";
      const envKey = Deno.env.get("EVOLUTION_API_KEY") || "";
      const finalServer = String(serverUrl || envServer).trim();
      const finalKey = String(apiKey || envKey).trim();

      if (!finalServer || !finalKey) {
        return json({
          error: "Configure EVOLUTION_SERVER_URL e EVOLUTION_API_KEY nos secrets, ou envie no body.",
        }, 400);
      }

      // Auto-slug do nome se instance não vier
      const slugify = (s: string) =>
        s.toLowerCase()
          .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 40) || `instance-${Date.now()}`;

      const cleanServer = finalServer.replace(/\/+$/, "");
      const baseSlug = instance ? String(instance).trim() : slugify(String(name));

      // Garante unicidade da instance no DB do usuário (evita colisão)
      let cleanInstance = baseSlug;
      let suffix = 1;
      while (true) {
        const { data: existing } = await admin
          .from("whatsapp_accounts")
          .select("id")
          .eq("user_id", userId)
          .eq("phone_number_id", cleanInstance)
          .maybeSingle();
        if (!existing) break;
        suffix += 1;
        cleanInstance = `${baseSlug}-${suffix}`;
        if (suffix > 50) {
          cleanInstance = `${baseSlug}-${Date.now()}`;
          break;
        }
      }

      // Reatribui apiKey limpa
      const apiKeyClean = finalKey;

      // 1) Cria a instance no Evolution (idempotente: se já existir, segue para connect)
      const createRes = await evoFetch(
        { serverUrl: cleanServer, apiKey: apiKeyClean, instance: cleanInstance, accountId: "" },
        "/instance/create",
        {
          method: "POST",
          body: JSON.stringify({
            instanceName: cleanInstance,
            qrcode: true,
            integration: "WHATSAPP-BAILEYS",
          }),
        },
      );

      // Aceita: 201 created OR já existente (status 403/409 com mensagem "already")
      const alreadyExists =
        !createRes.ok &&
        JSON.stringify(createRes.body || "").toLowerCase().includes("already");

      if (!createRes.ok && !alreadyExists) {
        return json({
          error: "Falha ao criar instance no Evolution",
          details: createRes.body,
          status: createRes.status,
        }, 400);
      }

      // 2) Salva account no DB
      // Segredo próprio da conta: antes toda instância Evolution de todo
      // cliente autenticava com o mesmo EVOLUTION_WEBHOOK_SECRET global — quem
      // conhecesse esse segredo podia forjar evento pra QUALQUER account_id.
      // Gerando um por conta, só quem registrou o webhook desta instância
      // específica consegue autenticar como ela.
      const webhookSecret = crypto.randomUUID();
      const { data: account, error: insErr } = await admin
        .from("whatsapp_accounts")
        .insert({
          user_id: userId,
          name,
          provider: "evolution",
          phone_number_id: cleanInstance,
          business_account_id: cleanServer,
          access_token: apiKeyClean,
          api_key: apiKeyClean,
          is_default,
          webhook_secret: webhookSecret,
        })
        .select()
        .single();

      if (insErr) {
        return json({ error: "Falha ao salvar conta", details: insErr.message }, 400);
      }

      // 3) Configura webhook automático apontando para esta plataforma
      const webhookUrl =
        `${supabaseUrl}/functions/v1/evolution-webhook?account_id=${account.id}` +
        `&secret=${encodeURIComponent(webhookSecret)}`;
      await evoFetch(
        { serverUrl: cleanServer, apiKey: apiKeyClean, instance: cleanInstance, accountId: account.id },
        `/webhook/set/${cleanInstance}`,
        {
          method: "POST",
          body: JSON.stringify({
            url: webhookUrl,
            enabled: true,
            webhook_by_events: false,
            events: [
              "MESSAGES_UPSERT",
              "MESSAGES_UPDATE",
              "CONNECTION_UPDATE",
              "QRCODE_UPDATED",
            ],
          }),
        },
      ).catch((e) => console.warn("Set webhook failed (non-critical):", e));

      // 4) Solicita QR Code (com backoff)
      const bo1 = await checkBackoff(admin, account.id);
      if (!bo1.allowed) {
        return json({
          ok: true,
          account_id: account.id,
          qr_code: null,
          pairing_code: null,
          webhook_url: webhookUrl,
          already_existed: alreadyExists,
          backoff: {
            blocked: true,
            retry_after_sec: bo1.retry_after_sec,
            attempts: bo1.state?.attempts ?? 0,
            reason: bo1.state?.last_reason,
          },
        });
      }

      const qrRes = await evoFetch(
        { serverUrl: cleanServer, apiKey: apiKeyClean, instance: cleanInstance, accountId: account.id },
        `/instance/connect/${cleanInstance}`,
        { method: "GET" },
      );

      const qrBody: any = qrRes.body || {};
      const qrCode = qrBody?.base64 || qrBody?.qrcode?.base64 || qrBody?.qr || null;
      const pairingCode = qrBody?.code || qrBody?.pairingCode || null;

      const hitLimit1 = detectQrLimit(qrBody);
      if (hitLimit1) {
        await recordAttempt(admin, bo1.key, bo1.state, "qr_limit", "QR code limit reached");
      } else if (!qrRes.ok || (!qrCode && !pairingCode)) {
        await recordAttempt(admin, bo1.key, bo1.state, "failed", `status_${qrRes.status}`);
      } else {
        // QR entregue: registramos como tentativa para escalonar caso o usuário fique gerando QR sem parear.
        // O webhook connection.update=open chamará success e zerará o backoff.
        await recordAttempt(admin, bo1.key, bo1.state, "failed", "qr_issued");
      }

      return json({
        ok: true,
        account_id: account.id,
        qr_code: qrCode,
        pairing_code: pairingCode,
        webhook_url: webhookUrl,
        already_existed: alreadyExists,
        backoff: hitLimit1 ? { blocked: true, qr_limit: true } : undefined,
      });
    }

    // --------- Connect existing account (gera novo QR) ---------
    if (action === "connect" || action === "qrcode") {
      const { account_id } = body;
      if (!account_id) return json({ error: "account_id obrigatório" }, 400);

      const { data: account } = await admin
        .from("whatsapp_accounts")
        .select("*")
        .eq("id", account_id)
        .eq("user_id", userId)
        .eq("provider", "evolution")
        .maybeSingle();

      if (!account) return json({ error: "Conta não encontrada" }, 404);

      // Backoff: bloqueia se ainda em cooldown
      const bo = await checkBackoff(admin, account.id);
      if (!bo.allowed) {
        return json({
          ok: false,
          blocked: true,
          retry_after_sec: bo.retry_after_sec,
          attempts: bo.state?.attempts ?? 0,
          reason: bo.state?.last_reason,
          message: `Aguarde ${bo.retry_after_sec}s antes de tentar novo QR (proteção anti-ban).`,
        }, 429);
      }

      const creds: EvoCreds = {
        serverUrl: (account.business_account_id || "").replace(/\/+$/, ""),
        apiKey: account.api_key || account.access_token,
        instance: account.phone_number_id,
        accountId: account.id,
      };

      const qrRes = await evoFetch(creds, `/instance/connect/${creds.instance}`, { method: "GET" });
      const qrBody: any = qrRes.body || {};
      const qrCode = qrBody?.base64 || qrBody?.qrcode?.base64 || qrBody?.qr || null;
      const pairingCode = qrBody?.code || qrBody?.pairingCode || null;

      const hitLimit = detectQrLimit(qrBody);
      if (hitLimit) {
        await recordAttempt(admin, bo.key, bo.state, "qr_limit", "QR code limit reached");
      } else if (!qrRes.ok || (!qrCode && !pairingCode)) {
        await recordAttempt(admin, bo.key, bo.state, "failed", `status_${qrRes.status}`);
      } else {
        await recordAttempt(admin, bo.key, bo.state, "failed", "qr_issued");
      }

      return json({
        ok: qrRes.ok && !hitLimit,
        qr_code: qrCode,
        pairing_code: pairingCode,
        backoff: hitLimit
          ? { blocked: true, qr_limit: true, retry_after_sec: BACKOFF_STEPS_SEC[QR_LIMIT_STEP_INDEX] }
          : undefined,
        raw: qrBody,
      });
    }

    // --------- Status (open / connecting / close) ---------
    if (action === "status") {
      const { account_id } = body;
      if (!account_id) return json({ error: "account_id obrigatório" }, 400);

      const { data: account } = await admin
        .from("whatsapp_accounts")
        .select("*")
        .eq("id", account_id)
        .eq("user_id", userId)
        .eq("provider", "evolution")
        .maybeSingle();

      if (!account) return json({ error: "Conta não encontrada" }, 404);

      const creds: EvoCreds = {
        serverUrl: (account.business_account_id || "").replace(/\/+$/, ""),
        apiKey: account.api_key || account.access_token,
        instance: account.phone_number_id,
        accountId: account.id,
      };

      const stRes = await evoFetch(creds, `/instance/connectionState/${creds.instance}`, { method: "GET" });
      const state =
        stRes.body?.instance?.state ||
        stRes.body?.state ||
        "unknown";

      // Conexão aberta → limpa backoff de QR
      if (state === "open") {
        await clearBackoffState(admin, `evo_qr_backoff:${account.id}`);
      }

      // Conserto de instâncias antigas: elas foram registradas com uma URL de
      // webhook sem segredo, e desde que o evolution-webhook passou a exigir
      // EVOLUTION_WEBHOOK_SECRET o servidor Evolution leva 403 em toda mensagem
      // — sem erro visível em lugar nenhum, só o chat mudo.
      //
      // Esta consulta de status é chamada a cada 20 segundos pelo monitor de
      // saúde da tela. A primeira versão disto só marcava a conta quando o
      // reaponte DAVA CERTO — então, falhando, ela repetia o POST de webhook a
      // cada 20 segundos, para sempre, contra o servidor Evolution. Instância
      // Baileys não gosta de ter o webhook reescrito o tempo todo: ela cai, o
      // monitor vê "close" e abre o QR. O conserto virava a doença.
      //
      // Agora a tentativa é marcada nos DOIS desfechos, e só se repete depois
      // da janela abaixo.
      const JANELA_REPARO_MS = 10 * 60 * 1000;
      const ultimoReparo = account.webhook_last_check_at
        ? new Date(account.webhook_last_check_at).getTime()
        : 0;
      const podeTentarReparo =
        !Number.isFinite(ultimoReparo) || Date.now() - ultimoReparo > JANELA_REPARO_MS;

      if (state === "open" && account.webhook_subscribed !== true && podeTentarReparo) {
        // Aproveita o reparo pra também migrar conta antiga (criada antes do
        // segredo por conta existir) pro segredo próprio dela, em vez de
        // religar de novo no EVOLUTION_WEBHOOK_SECRET global — senão toda
        // conta legada ficava presa no segredo compartilhado pra sempre.
        const accountSecret = account.webhook_secret || crypto.randomUUID();
        const fixUrl =
          `${supabaseUrl}/functions/v1/evolution-webhook?account_id=${account.id}` +
          `&secret=${encodeURIComponent(accountSecret)}`;

        // Pergunta antes de escrever. Ler o webhook atual não mexe em nada;
        // reescrevê-lo mexe. Se já estiver certo, não há o que consertar —
        // só marcar a conta e parar de olhar.
        const atual = await evoFetch(creds, `/webhook/find/${creds.instance}`, { method: "GET" })
          .catch(() => ({ ok: false, body: null }) as any);
        const urlAtual = String(atual?.body?.url || atual?.body?.webhook?.url || "");
        const jaEstaCerto =
          atual.ok && urlAtual.includes(`secret=${encodeURIComponent(accountSecret)}`);

        const setRes = jaEstaCerto
          ? ({ ok: true } as any)
          : await evoFetch(creds, `/webhook/set/${creds.instance}`, {
          method: "POST",
          body: JSON.stringify({
            url: fixUrl,
            enabled: true,
            webhook_by_events: false,
            events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "QRCODE_UPDATED"],
          }),
        }).catch(() => ({ ok: false }) as any);
        // Carimba mesmo falhando: é o carimbo que segura a repetição.
        await admin
          .from("whatsapp_accounts")
          .update({
            webhook_subscribed: setRes.ok ? true : account.webhook_subscribed ?? false,
            webhook_last_check_at: new Date().toISOString(),
            ...(setRes.ok && !account.webhook_secret ? { webhook_secret: accountSecret } : {}),
          })
          .eq("id", account.id);
        if (!setRes.ok) {
          console.error("evolution-instance: falha ao reapontar webhook", account.id);
        }
      }

      // Inclui info do backoff atual para a UI exibir
      const boState = await getBackoffState(admin, `evo_qr_backoff:${account.id}`);
      const retrySec = boState
        ? Math.max(0, Math.ceil((new Date(boState.next_allowed_at).getTime() - Date.now()) / 1000))
        : 0;

      return json({
        ok: stRes.ok,
        state,
        backoff: boState
          ? { attempts: boState.attempts, retry_after_sec: retrySec, reason: boState.last_reason }
          : null,
        raw: stRes.body,
      });
    }

    // --------- Logout (desconecta WhatsApp mas mantém instance) ---------
    if (action === "logout") {
      const { account_id } = body;
      if (!account_id) return json({ error: "account_id obrigatório" }, 400);

      const { data: account } = await admin
        .from("whatsapp_accounts")
        .select("*")
        .eq("id", account_id)
        .eq("user_id", userId)
        .eq("provider", "evolution")
        .maybeSingle();
      if (!account) return json({ error: "Conta não encontrada" }, 404);

      const creds: EvoCreds = {
        serverUrl: (account.business_account_id || "").replace(/\/+$/, ""),
        apiKey: account.api_key || account.access_token,
        instance: account.phone_number_id,
        accountId: account.id,
      };

      const res = await evoFetch(creds, `/instance/logout/${creds.instance}`, { method: "DELETE" });
      // Logout manual zera backoff (usuário decidiu reiniciar do zero)
      await clearBackoffState(admin, `evo_qr_backoff:${account.id}`);
      return json({ ok: res.ok, raw: res.body });
    }

    // --------- Reset backoff manualmente (admin override) ---------
    if (action === "reset_backoff") {
      const { account_id } = body;
      if (!account_id) return json({ error: "account_id obrigatório" }, 400);
      const { data: account } = await admin
        .from("whatsapp_accounts")
        .select("id")
        .eq("id", account_id)
        .eq("user_id", userId)
        .maybeSingle();
      if (!account) return json({ error: "Conta não encontrada" }, 404);
      await clearBackoffState(admin, `evo_qr_backoff:${account.id}`);
      return json({ ok: true });
    }

    return json({ error: "Ação inválida. Use: create_and_connect | connect | status | logout | reset_backoff" }, 400);
  } catch (err: any) {
    console.error("evolution-instance error:", err);
    return json({ error: err?.message || "Internal error" }, 500);
  }
});
