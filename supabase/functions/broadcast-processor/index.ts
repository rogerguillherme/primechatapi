import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEFAULT_BATCH_SIZE = 100;
const MAX_RETRIES = 2;
const ERROR_RATE_PAUSE_THRESHOLD = 10; // pause if > 10% errors
const CONSECUTIVE_ERROR_PAUSE = 5; // pause after 5 consecutive errors

// Critical Meta error codes
const INVALID_NUMBER_CODE = "131026";
const BLOCKED_CODE = "131048";
const RATE_LIMIT_CODE = "131056";
const SPAM_RATE_LIMIT_CODE = "131057";

function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function randomDelay(): Promise<void> {
  const ms = 300 + Math.random() * 1200; // 300ms to 1500ms
  return new Promise((r) => setTimeout(r, ms));
}

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

    // Fetch job
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

    if (["completed", "cancelled", "paused_by_system"].includes(job.status)) {
      return new Response(JSON.stringify({ message: `Job status: ${job.status}` }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── CHECK USER PLAN LIMITS ──
    const { data: planLimits } = await supabase
      .from("user_plan_limits")
      .select("*")
      .eq("user_id", job.user_id)
      .maybeSingle();

    if (planLimits) {
      // Reset daily counter if needed
      const lastReset = new Date(planLimits.last_reset_at);
      const now = new Date();
      if (lastReset.toDateString() !== now.toDateString()) {
        await supabase
          .from("user_plan_limits")
          .update({ messages_sent_today: 0, last_reset_at: now.toISOString(), updated_at: now.toISOString() })
          .eq("user_id", job.user_id);
        planLimits.messages_sent_today = 0;
      }

      if (planLimits.messages_sent_today >= planLimits.max_messages_per_day) {
        await supabase
          .from("broadcast_jobs")
          .update({ status: "paused_by_system", pause_reason: "Limite diário de mensagens atingido", updated_at: new Date().toISOString() })
          .eq("id", jobId);
        return new Response(JSON.stringify({ error: "Daily message limit reached" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Check contacts per campaign limit
      if (job.total_leads > planLimits.max_contacts_per_campaign) {
        await supabase
          .from("broadcast_jobs")
          .update({ status: "paused_by_system", pause_reason: `Limite de ${planLimits.max_contacts_per_campaign} contatos por campanha excedido`, updated_at: new Date().toISOString() })
          .eq("id", jobId);
        return new Response(JSON.stringify({ error: "Contacts per campaign limit exceeded" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Mark as processing
    await supabase
      .from("broadcast_jobs")
      .update({ status: "processing", updated_at: new Date().toISOString() })
      .eq("id", jobId);

    // ── GET ACCOUNT CREDENTIALS ──
    // Support multi-number distribution
    const accountIds: string[] = job.multi_number && job.account_ids?.length > 0
      ? job.account_ids
      : [job.account_id];

    const accountCredentials: Array<{ id: string; phoneNumberId: string; accessToken: string }> = [];

    for (const accId of accountIds) {
      const { data: acc } = await supabase
        .from("whatsapp_accounts")
        .select("id, phone_number_id, access_token, business_account_id")
        .eq("id", accId)
        .maybeSingle();

      if (!acc) continue;

      let accessToken = acc.access_token;
      if (acc.business_account_id) {
        const { data: metaConn } = await supabase
          .from("meta_connections")
          .select("meta_access_token")
          .eq("waba_id", acc.business_account_id)
          .eq("status", "connected")
          .maybeSingle();
        if (metaConn?.meta_access_token) accessToken = metaConn.meta_access_token;
      }

      accountCredentials.push({ id: acc.id, phoneNumberId: acc.phone_number_id, accessToken });
    }

    if (accountCredentials.length === 0) {
      await supabase
        .from("broadcast_jobs")
        .update({ status: "error", last_error: "Nenhuma conta WhatsApp encontrada", updated_at: new Date().toISOString() })
        .eq("id", jobId);
      return new Response(JSON.stringify({ error: "No accounts" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── WARM-UP MODE ──
    let batchSize = DEFAULT_BATCH_SIZE;
    if (job.warmup_mode) {
      const warmupDay = job.warmup_day || 0;
      const dailyLimit = job.warmup_daily_limit || 20;
      // Progressive: day0=20, day1=40, day2=80, day3=160...
      batchSize = Math.min(dailyLimit * Math.pow(2, warmupDay), DEFAULT_BATCH_SIZE);
      // Check if we've already sent enough for today in warmup mode
      const todaySent = job.sent_count || 0;
      const maxToday = dailyLimit * Math.pow(2, warmupDay);
      if (todaySent >= maxToday) {
        // Increment warmup day for tomorrow
        await supabase
          .from("broadcast_jobs")
          .update({ warmup_day: warmupDay + 1, status: "pending", pause_reason: "Aquecimento: limite do dia atingido", updated_at: new Date().toISOString() })
          .eq("id", jobId);
        return new Response(JSON.stringify({ message: "Warmup daily limit reached" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      batchSize = Math.min(batchSize, maxToday - todaySent);
    }

    // ── GET BATCH OF LEADS ──
    const cursor = job.last_cursor || 0;
    const leadIds: string[] = job.lead_ids || [];

    // Shuffle leads on first batch if enabled
    let orderedLeadIds = leadIds;
    if (cursor === 0 && job.shuffle_leads) {
      orderedLeadIds = shuffleArray(leadIds);
      // Save shuffled order back
      await supabase
        .from("broadcast_jobs")
        .update({ lead_ids: orderedLeadIds })
        .eq("id", jobId);
    }

    const batchLeadIds = orderedLeadIds.slice(cursor, cursor + batchSize);

    if (batchLeadIds.length === 0) {
      await supabase
        .from("broadcast_jobs")
        .update({ status: "completed", updated_at: new Date().toISOString() })
        .eq("id", jobId);
      return new Response(JSON.stringify({ message: "Job completed", job_id: jobId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch leads with last_inbound_at for 24h window check
    const { data: rawBatchLeads } = await supabase
      .from("leads")
      .select("id, name, phone, last_inbound_at")
      .in("id", batchLeadIds);

    // ── BLACKLIST FILTER ──
    let batchLeads = rawBatchLeads || [];
    let blacklistedSkipped = 0;
    if (batchLeads.length > 0) {
      const phonesToCheck = batchLeads.map((l) => (l.phone || "").replace(/\D/g, ""));
      const { data: blacklisted } = await supabase
        .from("lead_blacklist")
        .select("phone")
        .eq("user_id", job.user_id)
        .in("phone", phonesToCheck);

      const blacklistSet = new Set((blacklisted || []).map((b: any) => b.phone));
      const before = batchLeads.length;
      batchLeads = batchLeads.filter((l) => !blacklistSet.has((l.phone || "").replace(/\D/g, "")));
      blacklistedSkipped = before - batchLeads.length;
      if (blacklistedSkipped > 0) {
        console.log(`Skipped ${blacklistedSkipped} blacklisted leads in job ${jobId}`);
      }
    }

    if (!batchLeads || batchLeads.length === 0) {
      const newCursor = cursor + batchSize;
      const isComplete = newCursor >= leadIds.length;
      await supabase
        .from("broadcast_jobs")
        .update({ last_cursor: newCursor, status: isComplete ? "completed" : "processing", updated_at: new Date().toISOString() })
        .eq("id", jobId);
      if (!isComplete) await chainNextBatch(supabaseUrl, jobId);
      return new Response(JSON.stringify({ message: "Batch skipped", blacklistedSkipped }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── PROCESS BATCH ──
    const templateName = job.template_name;
    const templateLanguage = job.template_language || "pt_BR";
    const templateParams = job.template_params || [];
    const retryMap: Record<string, number> = job.retry_map || {};
    const rateLimit = job.messages_per_second || 75;

    let sentInBatch = 0;
    let errorsInBatch = 0;
    let consecutiveErrors = job.consecutive_errors || 0;
    let lastError = "";
    let accountIndex = 0; // for round-robin

    for (const lead of batchLeads) {
      // ── AUTO-PAUSE CHECK ──
      if (consecutiveErrors >= CONSECUTIVE_ERROR_PAUSE) {
        await supabase
          .from("broadcast_jobs")
          .update({
            status: "paused_by_system",
            pause_reason: `${CONSECUTIVE_ERROR_PAUSE} erros consecutivos detectados`,
            consecutive_errors: consecutiveErrors,
            sent_count: (job.sent_count || 0) + sentInBatch,
            error_count: (job.error_count || 0) + errorsInBatch,
            last_cursor: cursor + batchLeads.indexOf(lead),
            last_error: lastError,
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobId);
        return new Response(JSON.stringify({ message: "Job paused: consecutive errors", job_id: jobId }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Check error rate
      const totalProcessed = (job.sent_count || 0) + sentInBatch + (job.error_count || 0) + errorsInBatch;
      const totalErrors = (job.error_count || 0) + errorsInBatch;
      if (totalProcessed > 20 && (totalErrors / totalProcessed) * 100 > ERROR_RATE_PAUSE_THRESHOLD) {
        await supabase
          .from("broadcast_jobs")
          .update({
            status: "paused_by_system",
            pause_reason: `Taxa de erro acima de ${ERROR_RATE_PAUSE_THRESHOLD}% (${((totalErrors / totalProcessed) * 100).toFixed(1)}%)`,
            error_rate: parseFloat(((totalErrors / totalProcessed) * 100).toFixed(2)),
            sent_count: (job.sent_count || 0) + sentInBatch,
            error_count: (job.error_count || 0) + errorsInBatch,
            last_cursor: cursor + batchLeads.indexOf(lead),
            last_error: lastError,
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobId);
        return new Response(JSON.stringify({ message: "Job paused: high error rate", job_id: jobId }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // ── RANDOM DELAY (anti-spam) ──
      await randomDelay();

      // ── ROUND-ROBIN ACCOUNT SELECTION ──
      const currentAccount = accountCredentials[accountIndex % accountCredentials.length];
      accountIndex++;

      const cleanPhone = lead.phone.replace(/\D/g, "");
      const apiUrl = `https://graph.facebook.com/v21.0/${currentAccount.phoneNumberId}/messages`;

      // ── 24H WINDOW CHECK ──
      // Always use template for broadcast (safe default). 
      // If within 24h window, could send free-form, but templates are safer for bulk.
      const isWithin24h = lead.last_inbound_at &&
        (Date.now() - new Date(lead.last_inbound_at).getTime()) < 24 * 60 * 60 * 1000;

      try {
        // Resolve template params
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
            Authorization: `Bearer ${currentAccount.accessToken}`,
          },
          body: JSON.stringify(msgBody),
        });

        const waText = await waRes.text();
        let waData: any;
        try { waData = JSON.parse(waText); } catch { waData = { raw: waText }; }

        if (!waRes.ok) {
          const errorCode = String(waData?.error?.code || "");
          const errorMsg = waData?.error?.message || waText;

          // ── CRITICAL ERROR DETECTION ──
          let logStatus = "error";

          if (errorCode === BLOCKED_CODE || errorCode === SPAM_RATE_LIMIT_CODE) {
            // Blocked — stop sending to avoid further damage
            logStatus = "blocked";
            await supabase
              .from("broadcast_jobs")
              .update({
                status: "paused_by_system",
                pause_reason: `Número bloqueado ou rate-limited pela Meta (code: ${errorCode})`,
                sent_count: (job.sent_count || 0) + sentInBatch,
                error_count: (job.error_count || 0) + errorsInBatch + 1,
                last_cursor: cursor + batchLeads.indexOf(lead),
                last_error: errorMsg,
                updated_at: new Date().toISOString(),
              })
              .eq("id", jobId);

            // Log
            await supabase.from("message_logs").insert({
              job_id: jobId, user_id: job.user_id, lead_id: lead.id,
              phone: cleanPhone, status: logStatus, error_code: errorCode,
              error_message: errorMsg, account_id: currentAccount.id,
            });

            return new Response(JSON.stringify({ message: "Job paused: blocked", job_id: jobId }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          if (errorCode === RATE_LIMIT_CODE) {
            // Rate limit — wait and retry
            await new Promise((r) => setTimeout(r, 5000));
            logStatus = "rate_limited";
          }

          if (errorCode === INVALID_NUMBER_CODE) {
            logStatus = "invalid_number";
          }

          // Log error
          await supabase.from("message_logs").insert({
            job_id: jobId, user_id: job.user_id, lead_id: lead.id,
            phone: cleanPhone, status: logStatus, error_code: errorCode,
            error_message: errorMsg, account_id: currentAccount.id,
          });

          const retries = retryMap[lead.id] || 0;
          if (retries < MAX_RETRIES && logStatus !== "invalid_number") {
            retryMap[lead.id] = retries + 1;
          } else {
            errorsInBatch++;
            consecutiveErrors++;
            lastError = errorMsg;
          }
          continue;
        }

        // ── SUCCESS ──
        const waMessageId = waData.messages?.[0]?.id || null;
        sentInBatch++;
        consecutiveErrors = 0; // reset on success

        // Log success
        await supabase.from("message_logs").insert({
          job_id: jobId, user_id: job.user_id, lead_id: lead.id,
          phone: cleanPhone, status: "sent", wa_message_id: waMessageId,
          account_id: currentAccount.id,
        });

        const activityAt = new Date().toISOString();

        // Save outbound message
        await supabase.from("chat_messages").insert({
          lead_id: lead.id, direction: "outbound",
          content: `📋 Template: ${templateName}`,
          zapi_message_id: waMessageId, status: "sent",
          account_id: currentAccount.id,
        });

        const { error: leadUpdateError } = await supabase
          .from("leads")
          .update({ last_outbound_at: activityAt, updated_at: activityAt })
          .eq("id", lead.id);

        if (leadUpdateError) {
          console.error("Failed to update lead outbound activity:", leadUpdateError);
        }

        // ── AUTO-TRACK: Register campaign event ──
        const { error: campaignEventError } = await supabase.from("campaign_events").insert({
          campaign_id: jobId,
          lead_id: lead.id,
          lead_phone: cleanPhone,
          event_type: "sent",
        });
        if (campaignEventError) console.error("Failed to register campaign event:", campaignEventError);
      } catch (e: any) {
        await supabase.from("message_logs").insert({
          job_id: jobId, user_id: job.user_id, lead_id: lead.id,
          phone: cleanPhone, status: "error", error_message: e?.message || "Unknown",
          account_id: currentAccount.id,
        });

        const retries = retryMap[lead.id] || 0;
        if (retries < MAX_RETRIES) {
          retryMap[lead.id] = retries + 1;
        } else {
          errorsInBatch++;
          consecutiveErrors++;
          lastError = e?.message || "Unknown error";
        }
      }
    }

    // ── UPDATE JOB PROGRESS ──
    const newCursor = cursor + batchSize;
    const isComplete = newCursor >= leadIds.length;
    const newSent = (job.sent_count || 0) + sentInBatch;
    const newErrors = (job.error_count || 0) + errorsInBatch;
    const newTotal = newSent + newErrors;
    const errorRate = newTotal > 0 ? parseFloat(((newErrors / newTotal) * 100).toFixed(2)) : 0;

    await supabase
      .from("broadcast_jobs")
      .update({
        sent_count: newSent,
        error_count: newErrors,
        last_cursor: newCursor,
        retry_map: retryMap,
        last_error: lastError || job.last_error,
        consecutive_errors: consecutiveErrors,
        error_rate: errorRate,
        status: isComplete ? "completed" : "processing",
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    // Update user daily counter
    if (sentInBatch > 0) {
      await supabase.rpc("increment_daily_messages" as any, { p_user_id: job.user_id, p_count: sentInBatch }).catch(() => {
        // Fallback: direct update if RPC doesn't exist
        supabase
          .from("user_plan_limits")
          .update({ messages_sent_today: (planLimits?.messages_sent_today || 0) + sentInBatch, updated_at: new Date().toISOString() })
          .eq("user_id", job.user_id);
      });
    }

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
        error_rate: errorRate,
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
    // 1 second delay between batches
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
