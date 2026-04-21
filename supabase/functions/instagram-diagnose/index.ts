import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GRAPH = "https://graph.facebook.com/v19.0";

// Permissões necessárias para o app funcionar 100%
const REQUIRED_SCOPES = [
  "instagram_basic",
  "instagram_manage_messages",
  "instagram_manage_comments",
  "instagram_manage_insights",
  "pages_show_list",
  "pages_read_engagement",
];

// Campos que a página precisa estar inscrita
const REQUIRED_PAGE_FIELDS = [
  "messages",
  "messaging_postbacks",
  "feed",
];

// Campos que o IG user precisa estar inscrito
const REQUIRED_IG_FIELDS = [
  "comments",
  "messages",
  "mentions",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: claims, error: cerr } = await admin.auth.getClaims(token);
    if (cerr || !claims?.claims?.sub) return json({ error: "Unauthorized" }, 401);
    const userId = claims.claims.sub;

    const { data: connections } = await admin
      .from("instagram_connections")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "connected")
      .order("updated_at", { ascending: false });

    if (!connections?.length) return json({ error: "Nenhuma conexão Instagram conectada" }, 404);

    const diagnostics = [] as any[];

    for (const conn of connections) {
      const report: any = {
        connection_id: conn.id,
        username: conn.instagram_username,
        page_name: conn.page_name,
        page_id: conn.page_id,
        instagram_user_id: conn.instagram_user_id,
        permissions: { granted: [] as string[], missing: [] as string[], declined: [] as string[] },
        page_subscribed_fields: { current: [] as string[], missing: [] as string[] },
        ig_subscribed_fields: { current: [] as string[], missing: [] as string[] },
        token_valid: true,
        errors: [] as string[],
      };

      // 1. Resolve page token
      let pageToken = conn.access_token;
      if (conn.page_id) {
        try {
          const tr = await fetch(`${GRAPH}/${conn.page_id}?fields=access_token&access_token=${conn.access_token}`);
          const td = await tr.json();
          if (tr.ok && td.access_token) pageToken = td.access_token;
          else if (td.error) report.errors.push(`Page token: ${td.error.message}`);
        } catch (e) {
          report.errors.push(`Page token fetch failed: ${(e as Error).message}`);
        }
      }

      // 2. Check user permissions (uses user token)
      try {
        const pr = await fetch(`${GRAPH}/me/permissions?access_token=${conn.access_token}`);
        const pd = await pr.json();
        if (pr.ok && Array.isArray(pd.data)) {
          const granted = pd.data.filter((p: any) => p.status === "granted").map((p: any) => p.permission);
          const declined = pd.data.filter((p: any) => p.status === "declined").map((p: any) => p.permission);
          report.permissions.granted = granted;
          report.permissions.declined = declined;
          report.permissions.missing = REQUIRED_SCOPES.filter((s) => !granted.includes(s));
        } else if (pd.error) {
          report.token_valid = false;
          report.errors.push(`Permissions: ${pd.error.message}`);
        }
      } catch (e) {
        report.errors.push(`Permissions fetch failed: ${(e as Error).message}`);
      }

      // 3. Check page subscribed_fields
      if (conn.page_id) {
        try {
          const sr = await fetch(`${GRAPH}/${conn.page_id}/subscribed_apps?access_token=${pageToken}`);
          const sd = await sr.json();
          if (sr.ok && Array.isArray(sd.data) && sd.data.length > 0) {
            const fields: string[] = sd.data[0].subscribed_fields || [];
            report.page_subscribed_fields.current = fields;
            report.page_subscribed_fields.missing = REQUIRED_PAGE_FIELDS.filter((f) => !fields.includes(f));
          } else if (sd.error) {
            report.errors.push(`Page subscriptions: ${sd.error.message}`);
            report.page_subscribed_fields.missing = REQUIRED_PAGE_FIELDS;
          } else {
            // App not subscribed at all
            report.page_subscribed_fields.missing = REQUIRED_PAGE_FIELDS;
          }
        } catch (e) {
          report.errors.push(`Page subscriptions fetch failed: ${(e as Error).message}`);
        }
      }

      // 4. Check IG user subscribed_fields
      if (conn.instagram_user_id) {
        try {
          const ir = await fetch(`${GRAPH}/${conn.instagram_user_id}/subscribed_apps?access_token=${pageToken}`);
          const id = await ir.json();
          if (ir.ok && Array.isArray(id.data) && id.data.length > 0) {
            const fields: string[] = id.data[0].subscribed_fields || [];
            report.ig_subscribed_fields.current = fields;
            report.ig_subscribed_fields.missing = REQUIRED_IG_FIELDS.filter((f) => !fields.includes(f));
          } else if (id.error) {
            report.errors.push(`IG subscriptions: ${id.error.message}`);
            report.ig_subscribed_fields.missing = REQUIRED_IG_FIELDS;
          } else {
            report.ig_subscribed_fields.missing = REQUIRED_IG_FIELDS;
          }
        } catch (e) {
          report.errors.push(`IG subscriptions fetch failed: ${(e as Error).message}`);
        }
      }

      // Overall health
      report.healthy =
        report.token_valid &&
        report.permissions.missing.length === 0 &&
        report.page_subscribed_fields.missing.length === 0 &&
        report.ig_subscribed_fields.missing.length === 0;

      diagnostics.push(report);
    }

    return json({ ok: true, diagnostics });
  } catch (error) {
    console.error("instagram-diagnose error:", error);
    return json({ error: (error as Error).message || "Erro interno" }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
