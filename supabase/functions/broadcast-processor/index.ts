import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveTemplateHeaderLink } from "../_shared/template-media.ts";

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
// Códigos que indicam problema de pagamento/elegibilidade da conta — devem
// parar o disparo IMEDIATAMENTE (não adianta continuar, todas vão falhar).
const PAYMENT_ISSUE_CODES = new Set([
  "131042", // Business eligibility — pagamento/forma de pagamento ausente
  "131044", // Message undeliverable (frequentemente billing)
  "131047", // Re-engagement / 24h window — não vamos parar nesse aqui, removido abaixo se necessário
]);
// Removemos 131047 pois é janela de 24h por contato e não bloqueia a campanha inteira:
PAYMENT_ISSUE_CODES.delete("131047");
// Códigos POR DESTINATÁRIO: a Meta bloqueou apenas aquele contato.
// Pulamos o lead e seguimos o disparo com o restante da lista.
const SKIP_CODES = new Set([
  "131049", // limite de marketing por usuário
  "130472", // user experiments / destinatário fora do experimento
  "131047", // janela de 24h / re-engajamento
  "131026", // destinatário não pode receber
  "131056", // pair rate limit
]);

function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function randomDelay(minSec = 0.3, maxSec = 1.5): Promise<void> {
  const minMs = Math.max(0, minSec) * 1000;
  const maxMs = Math.max(minMs, maxSec * 1000);
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise((r) => setTimeout(r, ms));
}

// ============================================================
// UNIQUENESS HELPERS — anti-spam / anti-duplicate detection
// Each outgoing message gets a unique invisible signature so Meta
// cannot fingerprint identical payloads across the broadcast.
// ============================================================

const ZW_CHARS = ["\u200B", "\u200C", "\u200D", "\u2060"]; // zero-width space/non-joiner/joiner/word-joiner

function uniqueZeroWidthSuffix(): string {
  // 8 chars × 4 options = 65k combinations. Visually invisible.
  let s = "";
  for (let i = 0; i < 8; i++) {
    s += ZW_CHARS[Math.floor(Math.random() * ZW_CHARS.length)];
  }
  return s;
}

function varyName(rawName: string | null | undefined): string {
  const first = (rawName || "").trim().split(/\s+/)[0] || "";
  if (!first) return "amigo(a)";
  // Naturally rotate between presentations of the first name
  const variations = [
    first,                                                     // Maria
    first.toLowerCase(),                                       // maria
    first.charAt(0).toUpperCase() + first.slice(1).toLowerCase(), // Maria
  ];
  return variations[Math.floor(Math.random() * variations.length)];
}

function makeParamUnique(text: string, isLast: boolean): string {
  // Append zero-width signature only to the LAST parameter so the
  // user never sees odd characters mid-sentence.
  if (!isLast) return text;
  return `${text}${uniqueZeroWidthSuffix()}`;
}

type TemplateMediaHeader = {
  format: "image" | "video" | "document";
  link: string | null;
} | null;

async function fetchTemplateMediaHeader(
  accessToken: string,
  businessAccountId: string | null | undefined,
  templateName: string,
  language: string,
): Promise<TemplateMediaHeader> {
  if (!accessToken || !businessAccountId || !templateName) return null;

  try {
    const url = `https://graph.facebook.com/v21.0/${businessAccountId}/message_templates?name=${encodeURIComponent(templateName)}&limit=50&fields=name,language,status,components`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error("Failed to inspect template header:", response.status, JSON.stringify(payload));
      return null;
    }

    const templates = Array.isArray(payload?.data) ? payload.data : [];
    const targetLanguage = String(language || "pt_BR").toLowerCase();
    const targetName = String(templateName).toLowerCase();
    const template = templates.find((item: any) =>
      String(item?.name).toLowerCase() === targetName && String(item?.language).toLowerCase() === targetLanguage
    ) || templates.find((item: any) => String(item?.name).toLowerCase() === targetName) || templates[0];

    const header = (template?.components || []).find((component: any) => component?.type === "HEADER");
    const format = String(header?.format || "").toUpperCase();
    if (!["IMAGE", "VIDEO", "DOCUMENT"].includes(format)) return null;

    const example = header?.example || {};
    const exampleLink = example?.header_handle?.[0] || example?.header_url?.[0] || null;

    return {
      format: format.toLowerCase() as "image" | "video" | "document",
      link: typeof exampleLink === "string" && exampleLink.trim() ? exampleLink : null,
    };
  } catch (error) {
    console.error("Error inspecting template header:", error);
    return null;
  }
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
    console.log("broadcast-processor received request:", JSON.stringify(body));
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

    // ── ANTI-BAN v2 — RISK & SPAM PRE-FLIGHT CHECK ──
    // enforce_mode: off | shadow | enforce
    const { data: enforceSetting } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "antiban_v2_enforce_mode")
      .maybeSingle();
    const enforceMode = (enforceSetting?.value || "shadow") as "off" | "shadow" | "enforce";

    let riskCheckReason: string | null = null;
    let throughputMultiplier = 1.0;
    const reasons: string[] = [];
    const triggeredRules: string[] = [];
    let spamFeatures: any[] = [];
    let spamSnapshot: any = null;
    let historicalMetricsUsed: any = null;
    let campaignRiskSnapshot: any = null;

    if (enforceMode !== "off" && job.template_id) {
      // 1) Template spam score
      const { data: spam } = await supabase
        .from("template_spam_analysis")
        .select("spam_score, risk_level, warnings, analyzed_at")
        .eq("template_id", job.template_id)
        .maybeSingle();

      if (spam) {
        spamSnapshot = { spam_score: spam.spam_score, risk_level: spam.risk_level, analyzed_at: spam.analyzed_at };
        spamFeatures = Array.isArray(spam.warnings) ? spam.warnings : [];
        if (spam.risk_level === "critical") {
          riskCheckReason = `Conteúdo com risco crítico de spam (score ${spam.spam_score})`;
          throughputMultiplier = 0;
          reasons.push(riskCheckReason);
          triggeredRules.push("spam_score_critical");
        } else if (spam.risk_level === "high") {
          throughputMultiplier = Math.min(throughputMultiplier, 0.2);
          reasons.push(`Template com alto risco de spam (score ${spam.spam_score})`);
          triggeredRules.push("spam_score_high");
        } else if (spam.risk_level === "medium") {
          throughputMultiplier = Math.min(throughputMultiplier, 0.5);
          reasons.push(`Template com risco médio de spam (score ${spam.spam_score})`);
          triggeredRules.push("spam_score_medium");
        }
      }

      // 2) Historical campaign risk for this template
      const { data: history } = await supabase
        .from("campaign_risk_profiles")
        .select("risk_level, block_rate, unsubscribe_rate, reply_rate, delivery_rate, last_calculated_at, campaign_id")
        .contains("template_ids", [job.template_id])
        .eq("user_id", job.user_id)
        .order("last_calculated_at", { ascending: false })
        .limit(5);

      const hist = history ?? [];
      if (hist.length > 0) {
        historicalMetricsUsed = {
          samples: hist.length,
          avg_block_rate: hist.reduce((a, h) => a + Number(h.block_rate || 0), 0) / hist.length,
          avg_unsub_rate: hist.reduce((a, h) => a + Number(h.unsubscribe_rate || 0), 0) / hist.length,
          avg_delivery_rate: hist.reduce((a, h) => a + Number(h.delivery_rate || 0), 0) / hist.length,
          risk_levels: hist.map((h) => h.risk_level),
        };
      }
      const hasCritical = hist.some((h) => h.risk_level === "critical");
      const hasHigh = hist.some((h) => h.risk_level === "high");
      if (!riskCheckReason && hasCritical) {
        riskCheckReason = "Histórico crítico em campanhas anteriores deste template";
        throughputMultiplier = 0;
        reasons.push(riskCheckReason);
        triggeredRules.push("history_critical");
      } else if (hasHigh) {
        throughputMultiplier = Math.min(throughputMultiplier, 0.2);
        reasons.push("Histórico de risco alto em campanhas anteriores");
        triggeredRules.push("history_high");
      }
      campaignRiskSnapshot = hist[0] ?? null;
    }

    // Audit ALWAYS (passed or flagged) so shadow analytics can compare
    await supabase.from("audit_logs").insert({
      user_id: job.user_id,
      action: "antiban_v2_risk_check",
      table_name: "broadcast_jobs",
      record_id: jobId,
      details: {
        enforce_mode: enforceMode,
        passed: !riskCheckReason,
        flagged: throughputMultiplier < 1.0 || !!riskCheckReason,
        reason: riskCheckReason,
        reasons,
        triggered_rules: triggeredRules,
        throughput_multiplier: throughputMultiplier,
        template_id: job.template_id,
        spam_snapshot: spamSnapshot,
        spam_features: spamFeatures,
        historical_metrics_used: historicalMetricsUsed,
        campaign_risk_snapshot: campaignRiskSnapshot,
        total_leads: job.total_leads,
      },
    });


    // ENFORCE: bloquear se crítico
    if (enforceMode === "enforce" && riskCheckReason) {
      await supabase
        .from("broadcast_jobs")
        .update({
          status: "paused_by_system",
          pause_reason: `Anti-ban v2: ${riskCheckReason}`,
          risk_check_passed: false,
          risk_check_reason: riskCheckReason,
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);
      return new Response(
        JSON.stringify({ error: "Blocked by anti-ban v2", reason: riskCheckReason }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Mark as processing (e aplicar multiplier no enforce mode)
    const baseRate = job.messages_per_second || 1;
    const effectiveRate = enforceMode === "enforce"
      ? Math.max(1, Math.floor(baseRate * throughputMultiplier))
      : baseRate;

    await supabase
      .from("broadcast_jobs")
      .update({
        status: "processing",
        messages_per_second: effectiveRate,
        risk_check_passed: !riskCheckReason,
        risk_check_reason: riskCheckReason,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);


    // ── GET ACCOUNT CREDENTIALS ──
    // Support multi-number distribution
    const accountIds: string[] = job.multi_number && job.account_ids?.length > 0
      ? job.account_ids
      : [job.account_id];

    const accountCredentials: Array<{ id: string; phoneNumberId: string; accessToken: string; businessAccountId: string | null }> = [];

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

      accountCredentials.push({
        id: acc.id,
        phoneNumberId: acc.phone_number_id,
        accessToken,
        businessAccountId: acc.business_account_id,
      });
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
      .select("id, name, phone, last_inbound_at, unsubscribed")
      .in("id", batchLeadIds);

    // ── UNSUBSCRIBE FILTER ──
    let batchLeads = (rawBatchLeads || []).filter((l: any) => !l.unsubscribed);
    const unsubscribedSkipped = (rawBatchLeads?.length || 0) - batchLeads.length;
    if (unsubscribedSkipped > 0) {
      console.log(`Skipped ${unsubscribedSkipped} unsubscribed leads in job ${jobId}`);
    }

    // ── BLACKLIST FILTER ──
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
    // Per-job timing controls (jitter window between sends).
    // Falls back to legacy 0.3-1.5s window when not set.
    const delayMinSec = typeof job.delay_min_seconds === "number" ? job.delay_min_seconds : 0.3;
    const delayMaxSec = typeof job.delay_max_seconds === "number" ? job.delay_max_seconds : 1.5;

    let sentInBatch = 0;
    let errorsInBatch = 0;
    let consecutiveErrors = job.consecutive_errors || 0;
    let lastError = "";
    let accountIndex = 0; // for round-robin
    const templateHeaderCache: Record<string, Promise<TemplateMediaHeader>> = {};

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
      await randomDelay(delayMinSec, delayMaxSec);

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
        // Resolve template params with per-message uniqueness
        const paramArr = templateParams as any[];
        const resolvedParams = paramArr.map((p: any, idx: number) => {
          const text = typeof p === "string" ? p : p?.text || "";
          const isLast = idx === paramArr.length - 1;
          const baseText = (text
            .replace(/\{nome\}/g, varyName(lead.name))
            .replace(/\{codigo\}/g, "-")
            .replace(/\{\{\d+\}\}/g, "-")
            .trim() || "-");
          return {
            type: "text",
            text: makeParamUnique(baseText, isLast),
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

        const components: any[] = [];
        const headerCacheKey = `${currentAccount.id}:${templateName}:${templateLanguage}`;
        const templateHeader = templateHeaderCache[headerCacheKey] ||= fetchTemplateMediaHeader(
          currentAccount.accessToken,
          currentAccount.businessAccountId,
          templateName,
          templateLanguage,
        );
        const mediaHeader = await templateHeader;

        if (mediaHeader) {
          if (!mediaHeader.link) {
            throw new Error(`Template "${templateName}" exige cabeçalho ${mediaHeader.format.toUpperCase()}, mas a mídia de exemplo não está disponível.`);
          }

          const headerLink = await resolveTemplateHeaderLink(
            supabase,
            mediaHeader.link,
            `${currentAccount.businessAccountId}_${templateName}_${templateLanguage}`,
            mediaHeader.format,
          );

          components.push({
            type: "header",
            parameters: [{ type: mediaHeader.format, [mediaHeader.format]: { link: headerLink } }],
          });
        }


        if (resolvedParams.length > 0) {
          components.push({ type: "body", parameters: resolvedParams });
        }

        if (components.length > 0) {
          msgBody.template.components = components;
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

          // Erro de PAGAMENTO / elegibilidade — para o disparo imediatamente
          if (PAYMENT_ISSUE_CODES.has(errorCode)) {
            logStatus = "payment_issue";
            await supabase.from("message_logs").insert({
              job_id: jobId, user_id: job.user_id, lead_id: lead.id,
              phone: cleanPhone, status: logStatus, error_code: errorCode,
              meta_error_code: errorCode, error_message: errorMsg,
              account_id: currentAccount.id,
            });

            await supabase
              .from("broadcast_jobs")
              .update({
                status: "paused_by_system",
                pause_reason: `Problema de pagamento/elegibilidade da conta na Meta (code ${errorCode}). Disparo interrompido — configure a forma de pagamento no Business Manager.`,
                auto_paused_by_system: true,
                last_error: errorMsg,
                updated_at: new Date().toISOString(),
              })
              .eq("id", jobId);

            // Notifica via waba-protect-account (pausa flows, cria notificação)
            try {
              await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/waba-protect-account`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                },
                body: JSON.stringify({
                  account_id: currentAccount.id,
                  user_id: job.user_id,
                  reason: "payment_issue",
                  meta_error_code: errorCode,
                  meta_error_title: "Problema de pagamento na conta WhatsApp",
                  meta_error_details: errorMsg,
                  severity: "critical",
                }),
              });
            } catch (e) {
              console.error("waba-protect-account call failed:", e);
            }

            return new Response(JSON.stringify({ message: "Job paused: payment issue", job_id: jobId, error_code: errorCode }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          if (errorCode === BLOCKED_CODE || errorCode === SPAM_RATE_LIMIT_CODE || SKIP_CODES.has(errorCode)) {
            // Meta bloqueou ESTE destinatário — pula e segue com o restante.
            await supabase.from("message_logs").insert({
              job_id: jobId, user_id: job.user_id, lead_id: lead.id,
              phone: cleanPhone, status: "skipped", error_code: errorCode,
              meta_error_code: errorCode, error_message: errorMsg,
              account_id: currentAccount.id,
            });
            consecutiveErrors = 0; // não conta como erro para a proteção anti-ban
            continue;
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
      const { error: incrementError } = await supabase.rpc("increment_daily_messages" as any, { p_user_id: job.user_id, p_count: sentInBatch });
      if (incrementError) {
        console.error("Failed to increment daily messages via RPC:", incrementError);
        await supabase
          .from("user_plan_limits")
          .update({ messages_sent_today: (planLimits?.messages_sent_today || 0) + sentInBatch, updated_at: new Date().toISOString() })
          .eq("user_id", job.user_id);
      }
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
