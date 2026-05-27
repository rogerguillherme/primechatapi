// Anti-Ban v2 — Fase 1.2: Template Spam Scan
// On-demand (POST) e cron diário. Analisa templates de chat_templates e
// persiste em template_spam_analysis + cache em chat_templates.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { analyzeTemplateContent } from "../_shared/spamAnalyzer.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  let templateId: string | undefined;
  let userId: string | undefined;
  if (req.method === "POST") {
    try {
      const body = await req.json();
      templateId = body?.template_id;
      userId = body?.user_id;
    } catch { /* empty body = full scan */ }
  }

  try {
    let query = supabase
      .from("chat_templates")
      .select("id,user_id,content");

    if (templateId) query = query.eq("id", templateId);
    else if (userId) query = query.eq("user_id", userId);

    const { data: templates, error } = await query;
    if (error) throw error;

    const out: Array<Record<string, unknown>> = [];
    for (const t of templates ?? []) {
      if (!t.user_id) continue;
      const result = analyzeTemplateContent(t.content || "");

      await supabase
        .from("template_spam_analysis")
        .upsert(
          {
            user_id: t.user_id,
            template_id: t.id,
            spam_score: result.spam_score,
            risk_level: result.risk_level,
            warnings: result.warnings,
            content_snapshot: (t.content || "").slice(0, 2000),
            analyzed_at: new Date().toISOString(),
          },
          { onConflict: "template_id" },
        );

      await supabase
        .from("chat_templates")
        .update({
          spam_score: result.spam_score,
          spam_risk_level: result.risk_level,
        })
        .eq("id", t.id);

      out.push({ template_id: t.id, spam_score: result.spam_score, risk_level: result.risk_level });
    }

    return new Response(
      JSON.stringify({ ok: true, processed: out.length, results: out }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[template-spam-scan] error", e);
    return new Response(
      JSON.stringify({ ok: false, error: String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
