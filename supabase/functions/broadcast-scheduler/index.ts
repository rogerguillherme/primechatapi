// Scheduler: coleta broadcast_jobs marcados como "scheduled" cujo horário já
// chegou e entrega cada um ao broadcast-processor. Roda via pg_cron a cada minuto.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const nowIso = new Date().toISOString();

    const { data: due, error } = await admin
      .from("broadcast_jobs")
      .select("id, scheduled_at")
      .eq("status", "scheduled")
      .not("scheduled_at", "is", null)
      .lte("scheduled_at", nowIso)
      .order("scheduled_at", { ascending: true })
      .limit(20);

    if (error) return json({ error: error.message }, 500);
    if (!due || due.length === 0) return json({ triggered: 0 });

    const triggered: string[] = [];

    for (const job of due) {
      // Claim atômico: só um scheduler consegue mover de scheduled -> pending.
      const { data: claimed, error: claimError } = await admin
        .from("broadcast_jobs")
        .update({ status: "pending" })
        .eq("id", job.id)
        .eq("status", "scheduled")
        .select("id");

      if (claimError || !claimed || claimed.length === 0) continue;

      try {
        await fetch(`${SUPABASE_URL}/functions/v1/broadcast-processor`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({ job_id: job.id }),
        });
        triggered.push(job.id);
      } catch (invokeError) {
        console.error("Falha ao invocar broadcast-processor", job.id, invokeError);
      }
    }

    return json({ triggered: triggered.length, job_ids: triggered });
  } catch (e) {
    console.error("broadcast-scheduler error", e);
    return json({ error: e instanceof Error ? e.message : "unknown error" }, 500);
  }
});
