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
    const { data: userData, error: userErr } = await userClient.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);
    const userId = userData.user.id;

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
        })
        .select()
        .single();

      if (insErr) {
        return json({ error: "Falha ao salvar conta", details: insErr.message }, 400);
      }

      // 3) Configura webhook automático apontando para esta plataforma
      const webhookUrl = `${supabaseUrl}/functions/v1/evolution-webhook?account_id=${account.id}`;
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

      // 4) Solicita QR Code
      const qrRes = await evoFetch(
        { serverUrl: cleanServer, apiKey: apiKeyClean, instance: cleanInstance, accountId: account.id },
        `/instance/connect/${cleanInstance}`,
        { method: "GET" },
      );

      const qrBody: any = qrRes.body || {};
      const qrCode =
        qrBody?.base64 ||
        qrBody?.qrcode?.base64 ||
        qrBody?.qr ||
        null;
      const pairingCode = qrBody?.code || qrBody?.pairingCode || null;

      return json({
        ok: true,
        account_id: account.id,
        qr_code: qrCode,
        pairing_code: pairingCode,
        webhook_url: webhookUrl,
        already_existed: alreadyExists,
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

      return json({
        ok: qrRes.ok,
        qr_code: qrCode,
        pairing_code: pairingCode,
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

      return json({ ok: stRes.ok, state, raw: stRes.body });
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
      return json({ ok: res.ok, raw: res.body });
    }

    return json({ error: "Ação inválida. Use: create_and_connect | connect | status | logout" }, 400);
  } catch (err: any) {
    console.error("evolution-instance error:", err);
    return json({ error: err?.message || "Internal error" }, 500);
  }
});
