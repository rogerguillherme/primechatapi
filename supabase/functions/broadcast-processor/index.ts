import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BATCH_SIZE = 100;
const RATE_LIMIT_PER_SECOND = 75; // slightly under 80 for safety
const MAX_RETRIES = 2;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json();
    const { job_id } = body;

    // If called without job_id, pick the oldest pending/processing job
    let jobId = job_id;

    if (!jobId) {
      const { data: nextJob } = await supabase
        .from("broadcast_jobs")
        .select("id")
        .in("status", ["pending", "processing"])
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      
      if (!nextJob) {
        return new Response(JSON.stringify({ message: "No pending jobs" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      jobId = nextJob.id;
    }

    // Fetch job details
    const { data: job, error: jobError } = await supabase
      .from("broadcast_jobs")
      .select("*")
      .eq("id", jobId)
      .maybeSingle();

    if (jobError || !job) {
      return new Response(JSON.stringify({ error: "Job not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (job.status === "completed" || job.status === "cancelled") {
      return new Response(JSON.stringify({ message: "Job already finished" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mark as processing
    await supabase
      .from("broadcast_jobs")
      .update({ status: "processing", updated_at: new Date().toISOString() })
      .eq("id", jobId);

    // Get account credentials
    const { data: account } = await supabase
      .from("whatsapp_accounts")
      .select("phone_number_id, access_token, business_account_id")
      .eq("id", job.account_id)
      .maybeSingle();

    if (!account) {
      await supabase
        .from("broadcast_jobs")
        .update({ status: "error", last_error: "Conta WhatsApp não encontrada", updated_at: new Date().toISOString() })
        .eq("id", jobId);
      return new Response(JSON.stringify({ error: "Account not found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Try to get fresher token from meta_connections
    let accessToken = account.access_token;
    if (account.business_account_id) {
      const { data: metaConn } = await supabase
        .from("meta_connections")
        .select("meta_access_token")
        .eq("waba_id", account.business_account_id)
        .eq("status", "connected")
        .maybeSingle();
      if (metaConn?.meta_access_token) {
        accessToken = metaConn.meta_access_token;
      }
    }

    const phoneNumberId = account.phone_number_id;
    const apiUrl = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

    // Get the slice of leads for this batch
    const cursor = job.last_cursor || 0;
    const leadIds: string[] = job.lead_ids || [];
    const batchLeadIds = leadIds.slice(cursor, cursor + BATCH_SIZE);

    if (batchLeadIds.length === 0) {
      // All done
      await supabase
        .from("broadcast_jobs")
        .update({ status: "completed", updated_at: new Date().toISOString() })
        .eq("id", jobId);
      return new Response(JSON.stringify({ message: "Job completed", job_id: jobId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch lead data for this batch
    const { data: batchLeads } = await supabase
      .from("leads")
      .select("id, name, phone")
      .in("id", batchLeadIds);

    if (!batchLeads || batchLeads.length === 0) {
      // Skip this batch, move cursor
      const newCursor = cursor + BATCH_SIZE;
      const isComplete = newCursor >= leadIds.length;
      await supabase
        .from("broadcast_jobs")
        .update({
          last_cursor: newCursor,
          status: isComplete ? "completed" : "processing",
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);

      if (!isComplete) {
        // Chain next batch
        await chainNextBatch(supabaseUrl, jobId);
      }

      return new Response(JSON.stringify({ message: "Batch skipped (no leads found)" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build template body
    const templateName = job.template_name;
    const templateLanguage = job.template_language || "pt_BR";
    const templateParams = job.template_params || [];

    let sentInBatch = 0;
    let errorsInBatch = 0;
    let lastError = "";
    const retryMap: Record<string, number> = job.retry_map || {};

    // Rate limiting: send at most RATE_LIMIT_PER_SECOND per second
    const startTime = Date.now();
    let sentThisSecond = 0;

    for (const lead of batchLeads) {
      // Rate limit check
      if (sentThisSecond >= RATE_LIMIT_PER_SECOND) {
        const elapsed = Date.now() - startTime;
        const waitMs = Math.max(0, 1000 - (elapsed % 1000));
        if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
        sentThisSecond = 0;
      }

      const cleanPhone = lead.phone.replace(/\D/g, "");

      try {
        // Resolve template params with lead name
        const resolvedParams = (templateParams as any[]).map((p: any) => {
          const text = typeof p === "string" ? p : p?.text || "";
          return {
            type: "text",
            text: text
              .replace(/\{nome\}/g, lead.name.split(" ")[0] || "-")
              .replace(/\{codigo\}/g, "-")
              .replace(/\{\{\d+\}\}/g, "-")
              .trim() || "-",
          };
        });

        const msgBody: any = {
          messaging_product: "whatsapp",
          to: cleanPhone,
          type: "template",
          template: {
            name: templateName,
            language: { code: templateLanguage },
          },
        };

        if (resolvedParams.length > 0) {
          msgBody.template.components = [{ type: "body", parameters: resolvedParams }];
        }

        const waRes = await fetch(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(msgBody),
        });

        const waText = await waRes.text();
        let waData: any;
        try { waData = JSON.parse(waText); } catch { waData = { raw: waText }; }

        if (!waRes.ok) {
          const retries = retryMap[lead.id] || 0;
          if (retries < MAX_RETRIES) {
            retryMap[lead.id] = retries + 1;
            // Will retry in next batch
          } else {
            errorsInBatch++;
            lastError = waData?.error?.message || waText;
          }
          continue;
        }

        const waMessageId = waData.messages?.[0]?.id || null;
        sentInBatch++;
        sentThisSecond++;

        // Save outbound message
        await supabase.from("chat_messages").insert({
          lead_id: lead.id,
          direction: "outbound",
          content: `📋 Template: ${templateName}`,
          zapi_message_id: waMessageId,
          status: "sent",
          account_id: job.account_id,
        });
      } catch (e: any) {
        const retries = retryMap[lead.id] || 0;
        if (retries < MAX_RETRIES) {
          retryMap[lead.id] = retries + 1;
        } else {
          errorsInBatch++;
          lastError = e?.message || "Unknown error";
        }
      }
    }

    // Update job progress
    const newCursor = cursor + BATCH_SIZE;
    const isComplete = newCursor >= leadIds.length;

    await supabase
      .from("broadcast_jobs")
      .update({
        sent_count: (job.sent_count || 0) + sentInBatch,
        error_count: (job.error_count || 0) + errorsInBatch,
        last_cursor: newCursor,
        retry_map: retryMap,
        last_error: lastError || job.last_error,
        status: isComplete ? "completed" : "processing",
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    // Chain next batch if not complete
    if (!isComplete) {
      await chainNextBatch(supabaseUrl, jobId);
    }

    return new Response(
      JSON.stringify({
        message: isComplete ? "Job completed" : "Batch processed",
        job_id: jobId,
        sent_in_batch: sentInBatch,
        errors_in_batch: errorsInBatch,
        progress: `${Math.min(newCursor, leadIds.length)}/${leadIds.length}`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Broadcast processor error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function chainNextBatch(supabaseUrl: string, jobId: string) {
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  try {
    // Small delay before chaining (1 second between batches)
    await new Promise((r) => setTimeout(r, 1000));
    
    await fetch(`${supabaseUrl}/functions/v1/broadcast-processor`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify({ job_id: jobId }),
    });
  } catch (e) {
    console.error("Failed to chain next batch:", e);
  }
}
