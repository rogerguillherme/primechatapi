import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

const ACCESS_LEVELS = ["chat", "broadcast", "readonly", "manager"] as const;
const LEAD_SCOPES = ["all", "assigned"] as const;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Não autorizado" }, 401);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller }, error: authError } = await admin.auth.getUser(token);
    if (authError || !caller) return json({ error: "Sessão inválida" }, 401);

    const action = new URL(req.url).searchParams.get("action");

    // ── LIST ──────────────────────────────────────────────────────────────
    if (req.method === "GET" && action === "list") {
      const { data: members, error } = await admin
        .from("team_members")
        .select("*")
        .eq("owner_id", caller.id)
        .order("created_at", { ascending: true });
      if (error) throw error;

      const { data: { users } } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const userMap = new Map(users.map((u) => [u.id, u]));

      const mapped = (members ?? []).map((m) => {
        const u = userMap.get(m.member_user_id);
        return {
          ...m,
          email: u?.email ?? "—",
          display_name: (u?.user_metadata?.full_name as string) || "",
          last_sign_in_at: u?.last_sign_in_at ?? null,
        };
      });

      return json(mapped);
    }

    // ── CREATE ────────────────────────────────────────────────────────────
    if (req.method === "POST" && action === "create") {
      const body = await req.json().catch(() => null);
      if (!body) return json({ error: "Body inválido" }, 400);

      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      const displayName = String(body.display_name ?? "").trim();
      const accessLevel = String(body.access_level ?? "chat");
      const leadScope = String(body.lead_scope ?? "assigned");

      if (!email.includes("@")) return json({ error: "Email inválido" }, 400);
      if (password.length < 8) return json({ error: "A senha precisa ter no mínimo 8 caracteres" }, 400);
      if (!ACCESS_LEVELS.includes(accessLevel as typeof ACCESS_LEVELS[number])) {
        return json({ error: "Tipo de acesso inválido" }, 400);
      }
      if (!LEAD_SCOPES.includes(leadScope as typeof LEAD_SCOPES[number])) {
        return json({ error: "Escopo de leads inválido" }, 400);
      }

      // Reuse an existing account with the same email when it already exists.
      const { data: { users } } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      let memberId = users.find((u) => u.email?.toLowerCase() === email)?.id ?? null;

      if (!memberId) {
        const { data, error } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name: displayName },
        });
        if (error) return json({ error: error.message }, 400);
        memberId = data.user!.id;
      }

      if (memberId === caller.id) return json({ error: "Você já é o dono da conta" }, 400);

      const { error: linkError } = await admin.from("team_members").upsert(
        {
          owner_id: caller.id,
          member_user_id: memberId,
          access_level: accessLevel,
          lead_scope: leadScope,
        },
        { onConflict: "owner_id,member_user_id" },
      );
      if (linkError) return json({ error: linkError.message }, 400);

      return json({ success: true });
    }

    // ── UPDATE ────────────────────────────────────────────────────────────
    if (req.method === "PUT" && action === "update") {
      const body = await req.json().catch(() => null);
      if (!body?.member_user_id) return json({ error: "member_user_id é obrigatório" }, 400);

      const patch: Record<string, unknown> = {};
      if (body.access_level) {
        if (!ACCESS_LEVELS.includes(body.access_level)) return json({ error: "Tipo de acesso inválido" }, 400);
        patch.access_level = body.access_level;
      }
      if (body.lead_scope) {
        if (!LEAD_SCOPES.includes(body.lead_scope)) return json({ error: "Escopo de leads inválido" }, 400);
        patch.lead_scope = body.lead_scope;
      }

      if (Object.keys(patch).length > 0) {
        const { error } = await admin
          .from("team_members")
          .update(patch)
          .eq("owner_id", caller.id)
          .eq("member_user_id", body.member_user_id);
        if (error) return json({ error: error.message }, 400);
      }

      if (body.password) {
        if (String(body.password).length < 8) {
          return json({ error: "A senha precisa ter no mínimo 8 caracteres" }, 400);
        }
        // Only allowed for users linked to this owner.
        const { data: link } = await admin
          .from("team_members")
          .select("id")
          .eq("owner_id", caller.id)
          .eq("member_user_id", body.member_user_id)
          .maybeSingle();
        if (!link) return json({ error: "Colaborador não encontrado" }, 404);

        const { error } = await admin.auth.admin.updateUserById(body.member_user_id, {
          password: String(body.password),
        });
        if (error) return json({ error: error.message }, 400);
      }

      return json({ success: true });
    }

    // ── DELETE ────────────────────────────────────────────────────────────
    if (req.method === "DELETE" && action === "delete") {
      const body = await req.json().catch(() => null);
      if (!body?.member_user_id) return json({ error: "member_user_id é obrigatório" }, 400);

      const { error } = await admin
        .from("team_members")
        .delete()
        .eq("owner_id", caller.id)
        .eq("member_user_id", body.member_user_id);
      if (error) return json({ error: error.message }, 400);

      return json({ success: true });
    }

    return json({ error: "Ação inválida" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro interno";
    console.error("team-members error:", message);
    return json({ error: message }, 500);
  }
});
