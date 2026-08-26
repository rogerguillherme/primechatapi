import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/**
 * Gerencia links de compartilhamento EM NOME DE OUTRO USUÁRIO.
 *
 * Existe porque `whatsapp_accounts` e `share_links` são isolados por
 * `auth.uid()` — o operador do SaaS não enxerga a conta do cliente pelo
 * front, e afrouxar a RLS exporia o `access_token` de todos os clientes ao
 * navegador. Aqui o service role fica no servidor e nada sensível sai.
 *
 * Body: { action: "users" | "list" | "save" | "delete", ... }
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const { data: { user: caller }, error: callerErr } = await admin.auth.getUser(token);
    if (callerErr || !caller) return json({ error: "Não autenticado" }, 401);

    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: caller.id, _role: "admin" });
    if (!isAdmin) return json({ error: "Acesso restrito a administradores" }, 403);

    const body = await req.json().catch(() => ({}));
    const action = body?.action as string;

    // ── Clientes que têm alguma conta de WhatsApp ──
    if (action === "users") {
      const { data: accounts, error } = await admin
        .from("whatsapp_accounts")
        .select("user_id");
      if (error) throw error;

      const countByUser = new Map<string, number>();
      for (const a of accounts || []) {
        countByUser.set(a.user_id, (countByUser.get(a.user_id) ?? 0) + 1);
      }

      // Se a listagem de usuários falhar, ainda devolvemos os ids — a tela
      // fica feia, mas continua utilizável.
      const { data: listed } = await admin.auth.admin
        .listUsers({ page: 1, perPage: 1000 })
        .catch(() => ({ data: null }) as any);
      const emailById = new Map((listed?.users || []).map((u: any) => [u.id, u.email]));

      return json({
        users: [...countByUser.entries()]
          .map(([id, count]) => ({ id, email: emailById.get(id) || id, accounts: count }))
          .sort((a, b) => String(a.email).localeCompare(String(b.email))),
      });
    }

    const targetUserId = body?.user_id as string;
    if (!targetUserId) return json({ error: "user_id é obrigatório" }, 400);

    // ── Tudo que a tela precisa para o usuário alvo ──
    // Nunca devolve access_token: o front só precisa de nome e número.
    if (action === "list") {
      const [links, accounts, labels, stages] = await Promise.all([
        admin.from("share_links")
          .select("id, name, account_id, phone, message, label_id, stage_id, active, click_count")
          .eq("user_id", targetUserId).order("created_at", { ascending: false }),
        admin.from("whatsapp_accounts")
          .select("id, name, display_phone_number, is_default")
          .eq("user_id", targetUserId).order("name"),
        admin.from("chat_labels").select("id, name, color").eq("user_id", targetUserId).order("name"),
        admin.from("pipeline_stages").select("id, name, color, position").eq("owner_id", targetUserId).order("position"),
      ]);

      return json({
        links: links.data || [],
        accounts: accounts.data || [],
        labels: labels.data || [],
        stages: stages.data || [],
      });
    }

    if (action === "save") {
      const name = String(body?.name || "").trim();
      const phone = String(body?.phone || "").replace(/\D/g, "");
      if (!name) return json({ error: "Informe um nome para o link" }, 400);
      if (phone.length < 10) return json({ error: "Informe o número com DDI e DDD" }, 400);

      // Referências precisam pertencer ao MESMO usuário alvo — senão um link
      // do cliente A apontaria para a etiqueta/coluna/conta do cliente B.
      const owns = async (table: string, column: string, id: string | null) => {
        if (!id) return true;
        const { data } = await admin.from(table).select("id").eq("id", id).eq(column, targetUserId).maybeSingle();
        return !!data;
      };
      const accountId = body?.account_id || null;
      const labelId = body?.label_id || null;
      const stageId = body?.stage_id || null;

      if (!(await owns("whatsapp_accounts", "user_id", accountId))) {
        return json({ error: "A conta escolhida não pertence a esse cliente" }, 400);
      }
      if (!(await owns("chat_labels", "user_id", labelId))) {
        return json({ error: "A etiqueta escolhida não pertence a esse cliente" }, 400);
      }
      if (!(await owns("pipeline_stages", "owner_id", stageId))) {
        return json({ error: "A coluna escolhida não pertence a esse cliente" }, 400);
      }

      const payload = {
        user_id: targetUserId,
        name,
        account_id: accountId,
        phone,
        message: String(body?.message ?? ""),
        label_id: labelId,
        stage_id: stageId,
        active: body?.active !== false,
      };

      if (body?.id) {
        // O .eq no user_id impede editar link de outro cliente por id chutado.
        const { error } = await admin.from("share_links")
          .update(payload).eq("id", body.id).eq("user_id", targetUserId);
        if (error) throw error;
      } else {
        const { error } = await admin.from("share_links").insert(payload);
        if (error) throw error;
      }
      return json({ success: true });
    }

    if (action === "delete") {
      if (!body?.id) return json({ error: "id é obrigatório" }, 400);
      const { error } = await admin.from("share_links")
        .delete().eq("id", body.id).eq("user_id", targetUserId);
      if (error) throw error;
      return json({ success: true });
    }

    return json({ error: `Ação desconhecida: ${action}` }, 400);
  } catch (e: any) {
    console.error("admin-share-links:", e);
    return json({ error: e?.message || "Erro interno" }, 500);
  }
});
