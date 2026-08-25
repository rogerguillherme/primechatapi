/**
 * Regras automáticas de mudança de coluna (Kanban).
 *
 * Uma regra move o lead para `to_stage_id` quando o gatilho ocorre, opcionalmente
 * restrita à etapa de origem (`from_stage_id`). A avaliação é defensiva: qualquer
 * falha é apenas logada, nunca interrompe o processamento da mensagem.
 */

export type StageTrigger =
  | "inbound_message"
  | "keyword"
  | "outbound_message"
  | "send_failed";

interface StageAutomationRow {
  id: string;
  name: string;
  trigger_type: StageTrigger;
  keywords: string[] | null;
  from_stage_id: string | null;
  to_stage_id: string;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function applyStageAutomations(
  supabase: any,
  params: {
    userId: string | null | undefined;
    leadId: string | null | undefined;
    trigger: StageTrigger;
    messageText?: string | null;
  },
): Promise<string | null> {
  const { userId, leadId, trigger, messageText } = params;
  if (!userId || !leadId) return null;

  try {
    const triggers: StageTrigger[] =
      trigger === "inbound_message" ? ["inbound_message", "keyword"] : [trigger];

    const { data: rules, error } = await supabase
      .from("stage_automations")
      .select("id, name, trigger_type, keywords, from_stage_id, to_stage_id")
      .eq("user_id", userId)
      .eq("active", true)
      .in("trigger_type", triggers);

    if (error) throw error;
    if (!rules || rules.length === 0) return null;

    const { data: lead } = await supabase
      .from("leads")
      .select("stage_id")
      .eq("id", leadId)
      .maybeSingle();

    const currentStage: string | null = lead?.stage_id ?? null;
    const text = normalize(messageText || "");

    const matched = (rules as StageAutomationRow[]).find((rule) => {
      if (rule.from_stage_id && rule.from_stage_id !== currentStage) return false;
      if (rule.to_stage_id === currentStage) return false;
      if (rule.trigger_type === "keyword") {
        const keywords = (rule.keywords || []).map(normalize).filter(Boolean);
        if (keywords.length === 0 || !text) return false;
        return keywords.some((k) => text.includes(k));
      }
      return true;
    });

    if (!matched) return null;

    const { error: updateError } = await supabase
      .from("leads")
      .update({ stage_id: matched.to_stage_id })
      .eq("id", leadId);

    if (updateError) throw updateError;

    console.log(
      `[stage-automation] regra "${matched.name}" (${matched.trigger_type}) moveu lead ${leadId} para ${matched.to_stage_id}`,
    );
    return matched.to_stage_id;
  } catch (e) {
    console.error("[stage-automation] falhou:", e);
    return null;
  }
}
