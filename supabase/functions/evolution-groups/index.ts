// Evolution API – Grupos WhatsApp: listar contas Evolution da equipe e
// sincronizar os grupos de uma conta (fetch na Evolution + upsert em
// whatsapp_groups). Primeira fatia portada do Group Flow Hub.
//
// Multi-tenant: resolve o dono da conta a partir de quem chama (dono direto
// ou membro de equipe com acesso de gerente), mesmo padrão do team-members.

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

async function fetchGroupsFromEvolution(serverUrl: string, apiKey: string, instanceName: string) {
  const base = serverUrl.replace(/\/+$/, "").replace(/\/manager$/i, "");
  const res = await fetch(
    `${base}/group/fetchAllGroups/${encodeURIComponent(instanceName)}?getParticipants=false`,
    { headers: { apikey: apiKey, "Content-Type": "application/json" } },
  );
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const detail = body?.response?.message ?? body?.message ?? String(text).slice(0, 200);
    throw new Error(`Evolution HTTP ${res.status}: ${detail}`);
  }
  const list: any[] = Array.isArray(body) ? body : body?.groups ?? [];
  return list.map((g) => ({
    group_jid: g.id ?? g.remoteJid ?? g.jid,
    name: g.subject ?? g.name ?? "Sem nome",
    description: g.desc ?? g.description ?? null,
    photo_url: g.pictureUrl ?? g.profilePicUrl ?? null,
    participants_count: g.size ?? g.participantsCount ?? (Array.isArray(g.participants) ? g.participants.length : 0),
    admins_count: Array.isArray(g.participants) ? g.participants.filter((p: any) => p.admin).length : 0,
    invite_link: g.inviteUrl ?? null,
    group_created_at: g.creation ? new Date(g.creation * 1000).toISOString() : null,
  })).filter((g) => g.group_jid);
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
      return json({ error: "Unauthorized" }, 401);
    }
    const callerId = claimsData.claims.sub as string;

    const admin = createClient(supabaseUrl, serviceKey);

    // Dono real da conta: quem chama já é o dono, ou é membro de equipe com
    // acesso de gerente de outra conta.
    const { data: membership } = await admin
      .from("team_members")
      .select("owner_id")
      .eq("member_user_id", callerId)
      .eq("access_level", "manager")
      .limit(1)
      .maybeSingle();
    const ownerId = membership?.owner_id ?? callerId;

    const body = await req.json().catch(() => ({}));
    const action: string = body.action || "";

    // ── Listar contas Evolution da equipe (só o necessário pra escolher qual sincronizar) ──
    if (action === "accounts") {
      const { data, error } = await admin
        .from("whatsapp_accounts")
        .select("id, name, phone_number_id, groups_synced_at")
        .eq("user_id", ownerId)
        .eq("provider", "evolution");
      if (error) throw error;
      return json({ accounts: data ?? [] });
    }

    // ── Sincronizar: busca na Evolution e grava em whatsapp_groups ──
    if (action === "sync") {
      const { account_id } = body;
      if (!account_id) return json({ error: "account_id é obrigatório" }, 400);

      const { data: account, error: accErr } = await admin
        .from("whatsapp_accounts")
        .select("id, user_id, provider, phone_number_id, business_account_id, api_key, access_token")
        .eq("id", account_id)
        .eq("user_id", ownerId)
        .eq("provider", "evolution")
        .maybeSingle();
      if (accErr) throw accErr;
      if (!account) return json({ error: "Conta Evolution não encontrada." }, 404);

      const serverUrl = account.business_account_id;
      const apiKey = account.api_key || account.access_token;
      if (!serverUrl || !apiKey) {
        return json({ error: "Conta sem servidor/chave Evolution configurados." }, 400);
      }

      const groups = await fetchGroupsFromEvolution(serverUrl, apiKey, account.phone_number_id);

      if (groups.length > 0) {
        const rows = groups.map((g) => ({
          ...g,
          account_id: account.id,
          user_id: account.user_id,
        }));
        const { error: upsertErr } = await admin
          .from("whatsapp_groups")
          .upsert(rows, { onConflict: "account_id,group_jid" });
        if (upsertErr) throw upsertErr;
      }

      await admin
        .from("whatsapp_accounts")
        .update({ groups_synced_at: new Date().toISOString() })
        .eq("id", account.id);

      return json({ success: true, count: groups.length });
    }

    return json({ error: "Ação inválida" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro interno";
    console.error("evolution-groups error:", message);
    return json({ error: message }, 500);
  }
});
