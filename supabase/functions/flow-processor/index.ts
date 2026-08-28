import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { applyStepLabels } from "../_shared/flow-matching.ts";
import { interpolate } from "../_shared/interpolate.mjs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Espera total de um passo de delay: minutos + segundos (delay_min_seconds). */
function stepDelayMs(step: any): number {
  const minutes = Number(step?.delay_minutes) || 0;
  const seconds = Number(step?.delay_min_seconds) || 0;
  return (minutes * 60 + seconds) * 1000;
}

const READY_STATUSES = ["waiting_delay", "waiting_no_response"];
const RETRY_DELAY_MS = 5000;
// Janela para considerar um envio idêntico como duplicata. Ampliada para 6h
// para impedir que um reprocessamento reenvie mensagens que já foram aceitas.
const DUPLICATE_SEND_WINDOW_MS = 6 * 60 * 60 * 1000;
// Somente envios que DERAM CERTO bloqueiam um novo envio; falhas (ex.: #131047)
// devem poder ser reenviadas pelo número correto.
const SUCCESS_STATUSES = ["sent", "delivered", "read", "pending"];

function formatCurrency(v: any): string {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", "."));
  if (!isFinite(n)) return String(v ?? "");
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function buildVars(lead: any, metadata: any): Record<string, string> {
  const md = metadata || {};
  const fullName = (lead?.name || "").trim();
  const firstName = fullName.split(" ")[0] || "";
  const phone = lead?.phone || "";
  const amount = md.amount ?? md.value ?? md.price;
  const product = md.product_name ?? md.product ?? md.produto ?? "";
  const orderId = md.order_id ?? md.orderId ?? md.pedido ?? "";
  const codigo = md.codigo ?? md.code ?? "";
  const email = lead?.email ?? md.email ?? "";

  const vars: Record<string, string> = {
    nome: firstName,
    name: firstName,
    primeiro_nome: firstName,
    nome_completo: fullName,
    full_name: fullName,
    telefone: phone,
    phone: phone,
    email: String(email || ""),
    codigo: String(codigo || ""),
    code: String(codigo || ""),
    produto: String(product || ""),
    product: String(product || ""),
    product_name: String(product || ""),
    pedido: String(orderId || ""),
    order_id: String(orderId || ""),
    valor: amount != null ? formatCurrency(amount) : "",
    preco: amount != null ? formatCurrency(amount) : "",
    amount: amount != null ? formatCurrency(amount) : "",
    price: amount != null ? formatCurrency(amount) : "",
  };

  // Plus any raw metadata key (lower priority - doesn't override above)
  for (const [k, v] of Object.entries(md)) {
    if (vars[k] === undefined && v != null && typeof v !== "object") {
      vars[k] = String(v);
    }
  }
  return vars;
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Antes: 40 execuções processadas UMA POR VEZ. Um passo com áudio (upload
    // + envio) segurava toda a fila atrás dele, e a invocação estourava o
    // tempo antes de esvaziar o lote.
    //
    // Agora um punhado corre em paralelo. O limite é baixo de propósito: o
    // gargalo real não é este processo, é a API da Meta e o limite de envio do
    // número. Paralelismo alto aqui só troca "fila lenta" por "429 da Meta".
    const CONCURRENCY = Math.max(1, Number(Deno.env.get("FLOW_CONCURRENCY") || 5));
    const BATCH_LIMIT = 100;
    const POOL_LIMIT = 400;
    // Para de reivindicar trabalho novo antes do teto da edge function, para
    // não ser morto no meio de um envio já reivindicado.
    const DEADLINE = Date.now() + 100_000;
    const now = new Date().toISOString();

    // Busca um pool maior e embaralha antes de processar. Isso reduz a
    // contenção quando várias invocações concorrentes tentam reivindicar
    // exatamente as mesmas execuções (o que travava o throughput em ~1/run).
    const { data: readyPool } = await supabase
      .from("flow_executions")
      .select("*, current_step:flow_steps!current_step_id(*)")
      .in("status", READY_STATUSES)
      .lte("next_action_at", now)
      .order("next_action_at", { ascending: true })
      .limit(POOL_LIMIT);

    const shuffled = (readyPool || []).slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    // Uma execução por lead nesta rodada. Duas correndo em paralelo para o
    // mesmo contato entregariam as mensagens fora de ordem; a que sobrar é
    // pega na próxima rodada, que vem logo em seguida.
    const vistos = new Set<string>();
    const readyExecutions: any[] = [];
    for (const e of shuffled) {
      if (vistos.has(e.lead_id)) continue;
      vistos.add(e.lead_id);
      readyExecutions.push(e);
      if (readyExecutions.length >= BATCH_LIMIT) break;
    }


    if (!readyExecutions || readyExecutions.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, processed: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let processed = 0;
 
    const processOne = async (exec: any) => {
      let claimed = false;

      try {
        claimed = await claimExecution(exec, supabase);
        if (!claimed) {
          return;
        }

        const { data: lead } = await supabase
          .from("leads")
          .select("id, name, phone, unsubscribed")
          .eq("id", exec.lead_id)
          .single();

        if (!lead) {
          await supabase.from("flow_executions").update({
            status: "cancelled",
            updated_at: new Date().toISOString(),
          }).eq("id", exec.id);
          return;
        }

        // Skip & cancel if lead opted out
        if ((lead as any).unsubscribed) {
          await supabase.from("flow_executions").update({
            status: "cancelled",
            updated_at: new Date().toISOString(),
            metadata: { ...(exec.metadata || {}), cancel_reason: "lead_unsubscribed" },
          }).eq("id", exec.id);
          return;
        }


        const currentStep = exec.current_step;
        if (!currentStep) {
          await supabase.from("flow_executions").update({
            status: "completed",
            updated_at: new Date().toISOString(),
          }).eq("id", exec.id);
          return;
        }

        let executionAccountId = typeof exec.metadata?.account_id === "string" && exec.metadata.account_id
          ? exec.metadata.account_id
          : null;

        if (!executionAccountId) {
          // A janela de 24h da Meta é POR NÚMERO (phone_number_id). Portanto o
          // número correto para continuar a conversa é o que RECEBEU a última
          // mensagem do lead (inbound) — usar o último outbound gera erro
          // #131047 quando o lead respondeu em outro número.
          const { data: recentInbound } = await supabase
            .from("chat_messages")
            .select("account_id")
            .eq("lead_id", lead.id)
            .eq("direction", "inbound")
            .not("account_id", "is", null)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          executionAccountId = recentInbound?.account_id || null;

          if (!executionAccountId) {
            // Sem inbound conhecido: cai para o último outbound do lead.
            const { data: recentOutbound } = await supabase
              .from("chat_messages")
              .select("account_id")
              .eq("lead_id", lead.id)
              .eq("direction", "outbound")
              .not("account_id", "is", null)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();

            executionAccountId = recentOutbound?.account_id || null;
          }

          if (!executionAccountId) {
            // Fallback: user's default WhatsApp account
            const { data: flowRow } = await supabase
              .from("flows").select("user_id").eq("id", exec.flow_id).maybeSingle();
            if (flowRow?.user_id) {
              const { data: defaultAcc } = await supabase
                .from("whatsapp_accounts")
                .select("id")
                .eq("user_id", flowRow.user_id)
                .order("is_default", { ascending: false })
                .order("created_at", { ascending: true })
                .limit(1)
                .maybeSingle();
              executionAccountId = defaultAcc?.id || null;
            }
          }
        }

        // Persist the resolved account on the execution so subsequent steps
        // never drift to a different number.
        if (executionAccountId && exec.metadata?.account_id !== executionAccountId) {
          await supabase.from("flow_executions").update({
            metadata: { ...(exec.metadata || {}), account_id: executionAccountId },
            updated_at: new Date().toISOString(),
          }).eq("id", exec.id);
          exec.metadata = { ...(exec.metadata || {}), account_id: executionAccountId };
        }

        // Etiquetas configuradas neste passo (rastreia por onde o lead passou)
        await applyStepLabels(supabase, currentStep, lead?.id);

        // TAG: passo dedicado a etiquetar — as etiquetas já foram aplicadas acima
        if (currentStep.step_type === "tag") {
          await advanceToNextStep(exec, currentStep, lead, supabase, supabaseUrl, supabaseKey, executionAccountId);
          processed++;
          return;
        }

        if (currentStep.step_type === "no_response" || exec.status === "waiting_no_response") {
          // Um passo "Sem Resposta" pode ter várias condições configuradas
          // (tempo de espera, resposta atrasada, etiqueta do lead, padrão).
          // Cada condição aponta para um ramo diferente do fluxo.
          const outcome = await evaluateNoResponseConditions(exec, currentStep, lead, supabase);

          if (outcome.kind === "requeue") {
            // Nenhuma condição bateu ainda, mas há condições com tempo maior:
            // reagenda para o próximo limite em vez de abandonar o passo.
            await supabase.from("flow_executions").update({
              next_action_at: outcome.nextActionAt,
              updated_at: new Date().toISOString(),
            }).eq("id", exec.id);
            processed++;
            return;
          }

          await advanceToNextStep(
            exec, currentStep, lead, supabase, supabaseUrl, supabaseKey, executionAccountId,
            outcome.branchKey,
          );
          processed++;
          return;
        }


        // BLACKLIST: add lead to blacklist and continue
        if (currentStep.step_type === "blacklist") {
          const { data: flowRow } = await supabase
            .from("flows")
            .select("user_id")
            .eq("id", exec.flow_id)
            .maybeSingle();

          if (flowRow?.user_id) {
            await supabase.from("lead_blacklist").upsert(
              {
                user_id: flowRow.user_id,
                lead_id: lead.id,
                phone: (lead.phone || "").replace(/\D/g, ""),
                reason: currentStep.custom_message || "opt-out via fluxo",
                flow_id: exec.flow_id,
              },
              { onConflict: "user_id,phone", ignoreDuplicates: true }
            );
            console.log("Lead added to blacklist:", lead.id, "via flow:", exec.flow_id);
          }

          await advanceToNextStep(exec, currentStep, lead, supabase, supabaseUrl, supabaseKey, executionAccountId);
          processed++;
          return;
        }

        if (
          currentStep.step_type === "message" ||
          currentStep.step_type === "interactive_buttons" ||
          currentStep.step_type === "cta_url"
        ) {
          const sent = await sendStepMessage(currentStep, lead, supabase, supabaseUrl, supabaseKey, exec.metadata, executionAccountId);
          if (!sent) {
            console.error("Failed to send message for execution:", exec.id);
            await requeueExecution(exec, supabase);
            return;
          }
        }

        await advanceToNextStep(exec, currentStep, lead, supabase, supabaseUrl, supabaseKey, executionAccountId);
        processed++;
      } catch (stepErr) {
        console.error("Error processing execution:", exec.id, stepErr);
        if (claimed) {
          try {
            await requeueExecution(exec, supabase);
          } catch (requeueErr) {
            console.error("Failed to requeue execution:", exec.id, requeueErr);
          }
        }
      }
    };

    // Pool de trabalhadores: cada um puxa a próxima execução da lista até
    // acabar ou o tempo apertar. A reivindicação já é atômica (update
    // condicional em status + current_step_id), então rodar em paralelo não
    // duplica envio — só deixa de esperar um lead para começar o próximo.
    let cursor = 0;
    const workers = Array.from(
      { length: Math.min(CONCURRENCY, readyExecutions.length) },
      async () => {
        while (cursor < readyExecutions.length) {
          if (Date.now() > DEADLINE) {
            console.warn("[fluxo] tempo esgotado; o restante fica para a proxima rodada");
            return;
          }
          const exec = readyExecutions[cursor++];
          await processOne(exec);
        }
      },
    );
    await Promise.all(workers);

    const { data: moreReady } = await supabase
      .from("flow_executions")
      .select("next_action_at")
      .in("status", READY_STATUSES)
      .order("next_action_at")
      .limit(1);

    if (moreReady && moreReady.length > 0) {
      const nextAt = new Date(moreReady[0].next_action_at).getTime();
      const nowMs = Date.now();
      const delayMs = nextAt <= nowMs ? 1000 : Math.min(nextAt - nowMs, 55000);

      setTimeout(async () => {
        try {
          await fetch(`${supabaseUrl}/functions/v1/flow-processor`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify({ auto: true }),
          });
        } catch (e) {
          console.error("Self-invocation failed:", e);
        }
      }, delayMs);
    }

    return new Response(
      JSON.stringify({ ok: true, processed }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Flow processor error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function claimExecution(exec: any, supabase: any): Promise<boolean> {
  const attempts = (exec.metadata?.send_attempts || 0) + 1;

  if (attempts > 5) {
    console.error("Max retry attempts reached for execution:", exec.id);
    await supabase.from("flow_executions").update({
      status: "failed",
      updated_at: new Date().toISOString(),
    }).eq("id", exec.id);
    return false;
  }

  let query = supabase
    .from("flow_executions")
    .update({
      status: "running",
      metadata: {
        ...exec.metadata,
        send_attempts: attempts,
        last_claimed_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", exec.id)
    .eq("status", exec.status);

  if (exec.current_step_id === null) {
    query = query.is("current_step_id", null);
  } else {
    query = query.eq("current_step_id", exec.current_step_id);
  }

  const { data: claimed, error } = await query
    .select("id")
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!claimed) {
    console.log("Execution already claimed or moved:", exec.id);
    return false;
  }

  return true;
}

async function requeueExecution(exec: any, supabase: any) {
  await supabase.from("flow_executions").update({
    status: exec.status,
    next_action_at: new Date(Date.now() + RETRY_DELAY_MS).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", exec.id);
}

async function sendStepMessage(
  step: any,
  lead: any,
  supabase: any,
  supabaseUrl: string,
  supabaseKey: string,
  metadata?: any,
  accountId?: string | null,
): Promise<boolean> {
  const body: any = { phone: lead.phone, lead_id: lead.id };
  if (accountId) body.account_id = accountId;

  const vars = buildVars(lead, metadata);
  const firstName = vars.nome;
  let expectedLogContent: string | null = null;

  if (step.step_type === "cta_url") {
    const buttons = Array.isArray(step.buttons) ? step.buttons : [];
    const ctaBtn = buttons[0];
    const msgText = interpolate(step.custom_message || "Acesse o link abaixo:", vars);
    body.message = msgText;
    expectedLogContent = `🔗 ${msgText}`;
    if (ctaBtn?.url) {
      body.cta_url = { display_text: ctaBtn.title || "Acessar", url: ctaBtn.url };
    }
  } else if (step.step_type === "interactive_buttons") {
    const buttons = Array.isArray(step.buttons) ? step.buttons : [];
    const msgText = interpolate(step.custom_message || "Escolha uma opção:", vars);
    body.message = msgText;
    body.interactive_buttons = buttons;
    expectedLogContent = `🔘 ${msgText}`;
  } else if (step.template_id) {
    const variants = Array.isArray(step.template_variations) ? step.template_variations.filter((v: any) => typeof v === "string" && v) : [];
    const pool = [step.template_id, ...variants];
    const chosenTemplateId = pool[Math.floor(Math.random() * pool.length)];
    if (variants.length > 0) {
      console.log("Template rotation:", step.id, "chose", chosenTemplateId, "from pool of", pool.length);
    }
    const { data: template } = await supabase
      .from("chat_templates")
      .select("*")
      .eq("id", chosenTemplateId)
      .single();

    if (template?.template_name) {
      body.template_name = template.template_name;
      body.template_language = template.template_language || "pt_BR";
      const rawParams = (template.template_params || []) as any[];
      body.template_params = rawParams.map((p: any) => {
        const text = typeof p === "string" ? p : p?.text || "";
        const resolved = interpolate(text, vars);
        return { type: "text", text: resolved || firstName };
      });
      expectedLogContent = template.content || `📋 Template: ${template.template_name}`;
    } else if (template) {
      body.message = template.content;
      expectedLogContent = template.content;
    }
  } else if (step.custom_message) {
    body.message = interpolate(step.custom_message, vars);
    expectedLogContent = body.message;
  }

  // Attach media if present (works as image-only or image + caption)
  if (step.step_type === "message" && step.media_url) {
    body.media_url = step.media_url;
    body.media_type = step.media_type || "image";
    if (step.file_name) body.file_name = step.file_name;
    if (!expectedLogContent) {
      expectedLogContent =
        body.media_type === "image"
          ? "📷 Imagem"
          : body.media_type === "audio"
            ? "🎤 Áudio"
            : body.media_type === "video"
              ? "🎥 Vídeo"
              : "📎 Arquivo";
    }
  }

  if (!body.message && !body.template_name && !body.interactive_buttons && !body.cta_url && !body.media_url) {
    console.error("No message to send for step:", step.id);
    return false;
  }

  if (expectedLogContent) {
    const windowStart = new Date(Date.now() - DUPLICATE_SEND_WINDOW_MS).toISOString();
    let duplicateQuery = supabase
      .from("chat_messages")
      .select("id, created_at, status")
      .eq("lead_id", lead.id)
      .eq("direction", "outbound")
      .eq("content", expectedLogContent)
      .in("status", SUCCESS_STATUSES)
      .gte("created_at", windowStart);

    // Mídia sem legenda é registrada com um texto fixo por tipo ("🎤 Áudio",
    // "📷 Imagem"...). Comparando só o conteúdo, o segundo áudio do fluxo
    // parecia repetição do primeiro e era descartado em silêncio — o fluxo
    // avançava como se tivesse enviado. A URL distingue um passo do outro.
    if (body.media_url) {
      duplicateQuery = duplicateQuery.eq("media_url", body.media_url);
    }

    const { data: recentDuplicate, error: duplicateError } = await duplicateQuery
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (duplicateError) {
      console.error("Duplicate check failed:", duplicateError);
    }

    if (recentDuplicate) {
      console.log(
        "Envio ignorado por duplicidade:",
        JSON.stringify({
          step: step.id,
          lead: lead.id,
          original: recentDuplicate.id,
          content: expectedLogContent,
          media_url: body.media_url || null,
        }),
      );
      return true;
    }
  }

  console.log("Sending message for step:", step.id, JSON.stringify(body));

  const sendRes = await fetch(`${supabaseUrl}/functions/v1/whatsapp-cloud-send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${supabaseKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!sendRes.ok) {
    const errText = await sendRes.text();
    console.error("whatsapp-cloud-send failed:", sendRes.status, errText);
    return false;
  }

  await sendRes.text();
  return true;
}

async function advanceToNextStep(
  exec: any,
  currentStep: any,
  lead: any,
  supabase: any,
  supabaseUrl: string,
  supabaseKey: string,
  accountId?: string | null,
) {
  let nextStep: any = null;

  // `send_attempts` conta tentativas de UM passo. Sem zerar ao avançar, o
  // contador acumulava ao longo do fluxo e a execução era marcada como
  // `failed` no 5º passo processado (normalmente no meio dos áudios), mesmo
  // com todos os envios bem-sucedidos. Zeramos a cada avanço.
  const clearedMetadata = { ...(exec.metadata || {}), send_attempts: 0 };

  const { data: childSteps } = await supabase
    .from("flow_steps")
    .select("*")
    .eq("flow_id", exec.flow_id)
    .eq("parent_step_id", currentStep.id)
    .order("step_order");

  if (childSteps && childSteps.length > 0) {
    if (
      currentStep.step_type === "cta_url" &&
      childSteps.length === 1 &&
      childSteps[0].step_type === "condition"
    ) {
      const { data: conditionChildren } = await supabase
        .from("flow_steps")
        .select("*")
        .eq("flow_id", exec.flow_id)
        .eq("parent_step_id", childSteps[0].id)
        .order("step_order");

      if (conditionChildren && conditionChildren.length > 0) {
        console.log("Bypassing virtual condition after CTA URL step:", childSteps[0].id, "next:", conditionChildren[0].id);
        nextStep = conditionChildren[0];
      } else {
        await supabase.from("flow_executions").update({
          status: "completed",
      metadata: clearedMetadata,
          updated_at: new Date().toISOString(),
        }).eq("id", exec.id);
        return;
      }
    } else
    if (childSteps.length === 1) {
      nextStep = childSteps[0];
    } else {
      const hasConditionalBranches = childSteps.some((step: any) => step.step_type === "condition");

      if (currentStep.step_type === "interactive_buttons" || hasConditionalBranches) {
        await supabase.from("flow_executions").update({
          current_step_id: currentStep.id,
          status: "waiting_reply",
          metadata: clearedMetadata,
          updated_at: new Date().toISOString(),
        }).eq("id", exec.id);
        return;
      }
      // O construtor deixa ligar um passo a vários, mas o motor segue um
      // caminho só. Os demais ramos são abandonados aqui — sem este aviso,
      // some sem rastro e o fluxo termina como se tivesse enviado tudo.
      console.warn(
        "[fluxo] passo com varios ramos: seguindo apenas o primeiro",
        JSON.stringify({
          flow: exec.flow_id,
          passo: currentStep.id,
          seguindo: childSteps[0].id,
          ignorados: childSteps.slice(1).map((c: any) => c.id),
        }),
      );
      nextStep = childSteps[0];
    }
  }
  // Fallback: linear ordering (nodes not connected via parent_step_id)
  if (!nextStep) {
    const { data: nextSteps } = await supabase
      .from("flow_steps")
      .select("*")
      .eq("flow_id", exec.flow_id)
      .gt("step_order", currentStep.step_order)
      .is("parent_step_id", null)
      .order("step_order")
      .limit(1);
    
    if (nextSteps && nextSteps.length > 0) {
      nextStep = nextSteps[0];
    }
  }

  if (!nextStep) {
    await supabase.from("flow_executions").update({
      status: "completed",
      metadata: clearedMetadata,
      updated_at: new Date().toISOString(),
    }).eq("id", exec.id);
    return;
  }

  if (nextStep.step_type === "delay") {
    await supabase.from("flow_executions").update({
      current_step_id: nextStep.id,
      status: "waiting_delay",
      metadata: clearedMetadata,
      next_action_at: new Date(Date.now() + stepDelayMs(nextStep)).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", exec.id);
  } else if (nextStep.step_type === "no_response") {
    const timeoutMin = nextStep.timeout_minutes || 10;
    await supabase.from("flow_executions").update({
      current_step_id: nextStep.id,
      status: "waiting_no_response",
      metadata: clearedMetadata,
      next_action_at: new Date(Date.now() + timeoutMin * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", exec.id);
  } else if (nextStep.step_type === "condition") {
    await supabase.from("flow_executions").update({
      current_step_id: nextStep.id,
      status: "waiting_reply",
      metadata: clearedMetadata,
      updated_at: new Date().toISOString(),
    }).eq("id", exec.id);
  } else if (
    nextStep.step_type === "message" ||
    nextStep.step_type === "interactive_buttons" ||
    nextStep.step_type === "cta_url" ||
    nextStep.step_type === "blacklist" ||
    nextStep.step_type === "tag"
  ) {
    await supabase.from("flow_executions").update({
      current_step_id: nextStep.id,
      status: "waiting_delay",
      metadata: clearedMetadata,
      next_action_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", exec.id);
  }
}
