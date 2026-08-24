import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function expectedErrorResponse(message: string, code = "VALIDATION_ERROR") {
  return jsonResponse({ success: false, error: message, code }, 200);
}

function normalizeAdminAuthError(error: any) {
  const rawMessage = String(error?.message || "Erro desconhecido");
  const lowerMessage = rawMessage.toLowerCase();

  if (
    lowerMessage.includes("weak") ||
    lowerMessage.includes("easy to guess") ||
    lowerMessage.includes("known to be") ||
    lowerMessage.includes("pwned") ||
    lowerMessage.includes("password should") ||
    lowerMessage.includes("password must")
  ) {
    return {
      status: 400,
      message: "Senha muito fraca ou vazada. Use uma senha mais forte, com letras, números e símbolos.",
    };
  }

  return {
    status: error?.status && error.status >= 400 && error.status < 500 ? error.status : 500,
    message: rawMessage,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return expectedErrorResponse("Não autorizado", "UNAUTHORIZED");
    }

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) {
      return expectedErrorResponse("Não autorizado", "UNAUTHORIZED");
    }

    if (caller.email !== "admin@primechat.com") {
      return jsonResponse({ error: "Acesso negado. Apenas o administrador principal." }, 403);
    }

    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    // LIST USERS
    if (req.method === "GET" && action === "list") {
      const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers();
      if (error) throw error;

      const { data: roles } = await supabaseAdmin.from("user_roles").select("*");
      const roleMap = new Map<string, string>();
      roles?.forEach((r: any) => roleMap.set(r.user_id, r.role));

      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("user_id, instagram_enabled, trial_ends_at");
      const igMap = new Map<string, boolean>();
      const expiryMap = new Map<string, string | null>();
      profiles?.forEach((p: any) => {
        igMap.set(p.user_id, !!p.instagram_enabled);
        expiryMap.set(p.user_id, p.trial_ends_at ?? null);
      });

      const mapped = users.map((u: any) => ({
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
        display_name: u.user_metadata?.full_name || u.user_metadata?.name || "",
        role: roleMap.get(u.id) || "user",
        instagram_enabled: igMap.get(u.id) || false,
        access_expires_at: expiryMap.get(u.id) ?? null,
      }));

      return jsonResponse(mapped);
    }

    // CREATE USER
    if (req.method === "POST" && action === "create") {
      const { email, password, display_name, role, access_expires_at } = await req.json();

      // Validação: quando informada, a data de expiração precisa ser válida.
      if (access_expires_at != null && Number.isNaN(new Date(access_expires_at).getTime())) {
        return expectedErrorResponse("Data de expiração de acesso inválida");
      }
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: display_name },
      });
      if (error) {
        console.error("Error creating user:", error.message);
        const normalized = normalizeAdminAuthError(error);
        if (normalized.status === 400 || normalized.status === 422) {
          return expectedErrorResponse(normalized.message);
        }
        return jsonResponse({ error: normalized.message }, normalized.status);
      }

      if (role && data.user) {
        await supabaseAdmin.from("user_roles").upsert({
          user_id: data.user.id,
          role,
        });
      }

      if (data.user) {
        // trial_ends_at guarda o limite de acesso da conta (NULL = acesso livre).
        const { error: expErr } = await supabaseAdmin
          .from("profiles")
          .update({ trial_ends_at: access_expires_at ?? null })
          .eq("user_id", data.user.id);
        if (expErr) console.error("Error setting access expiry:", expErr.message);
      }

      return jsonResponse({ success: true, user: data.user });
    }

    // UPDATE USER
    if (req.method === "PUT" && action === "update") {
      let body;
      try {
        body = await req.json();
      } catch (e) {
        return jsonResponse({ error: "Body inválido" }, 400);
      }

      const { user_id, email, password, display_name, role, instagram_enabled } = body;
      const hasAccessExpiry = Object.prototype.hasOwnProperty.call(body, "access_expires_at");
      const accessExpiresAt: string | null = body.access_expires_at ?? null;

      if (hasAccessExpiry && accessExpiresAt != null && Number.isNaN(new Date(accessExpiresAt).getTime())) {
        return expectedErrorResponse("Data de expiração de acesso inválida");
      }

      if (!user_id) {
        return jsonResponse({ error: "user_id é obrigatório" }, 400);
      }

      console.log("Updating user:", user_id, "role:", role, "display_name:", display_name);

      const updateData: any = {};
      if (email) updateData.email = email;
      if (password) updateData.password = password;
      if (display_name !== undefined) updateData.user_metadata = { full_name: display_name };

      if (Object.keys(updateData).length > 0) {
        const { error } = await supabaseAdmin.auth.admin.updateUserById(user_id, updateData);
        if (error) {
          console.error("Error updating user:", error.message);
          const normalized = normalizeAdminAuthError(error);
          if (normalized.status === 400 || normalized.status === 422) {
            return expectedErrorResponse(normalized.message);
          }
          return jsonResponse({ error: normalized.message }, normalized.status);
        }
      }

      // Update role - delete existing then insert new
      if (role) {
        const { error: delError } = await supabaseAdmin.from("user_roles")
          .delete()
          .eq("user_id", user_id);
        if (delError) console.error("Error deleting old role:", delError.message);

        const { error: insError } = await supabaseAdmin.from("user_roles")
          .insert({ user_id, role });
        if (insError) console.error("Error inserting new role:", insError.message);
      }

      if (typeof instagram_enabled === "boolean") {
        const { error: profErr } = await supabaseAdmin
          .from("profiles")
          .update({ instagram_enabled })
          .eq("user_id", user_id);
        if (profErr) console.error("Error updating instagram_enabled:", profErr.message);
      }

      if (hasAccessExpiry) {
        const { error: expErr } = await supabaseAdmin
          .from("profiles")
          .update({ trial_ends_at: accessExpiresAt })
          .eq("user_id", user_id);
        if (expErr) console.error("Error updating access expiry:", expErr.message);
      }

      return jsonResponse({ success: true });
    }

    // DELETE USER
    if (req.method === "DELETE" && action === "delete") {
      let body;
      try {
        body = await req.json();
      } catch (e) {
        return jsonResponse({ error: "Body inválido" }, 400);
      }

      const { user_id } = body;
      if (user_id === caller.id) {
        return jsonResponse({ error: "Não é possível excluir sua própria conta" }, 400);
      }
      const { error } = await supabaseAdmin.auth.admin.deleteUser(user_id);
      if (error) throw error;

      return jsonResponse({ success: true });
    }

    return jsonResponse({ error: "Ação inválida" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro interno";
    console.error("admin-users error:", message);
    return jsonResponse({ error: message }, 500);
  }
});
