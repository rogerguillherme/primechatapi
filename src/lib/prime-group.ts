// Helpers e tipos compartilhados do módulo Prime Group (clone isolado do
// Group Flow dentro do Prime Chat). As tabelas pg_* são novas e ainda não
// estão nos tipos gerados do Supabase, então usamos `(supabase as any)` —
// mesmo padrão já adotado em whatsapp_groups.
import { supabase } from "@/integrations/supabase/client";

export type CampaignStatus =
  | "rascunho" | "agendada" | "enviando" | "pausada" | "concluida" | "falhou";

export interface PgCampaign {
  id: string;
  user_id: string;
  account_id: string | null;
  name: string;
  message: string;
  media_url: string | null;
  media_type: string | null;
  status: CampaignStatus;
  scheduled_at: string | null;
  interval_min: number;
  interval_max: number;
  total_targets: number;
  sent_count: number;
  error_count: number;
  created_at: string;
  updated_at: string;
}

export interface PgTarget {
  id: string;
  campaign_id: string;
  group_id: string | null;
  group_jid: string;
  group_name: string;
  status: "pendente" | "enviado" | "erro";
  error: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface PgActivity {
  id: string;
  user_id: string;
  campaign_id: string | null;
  type: string;
  title: string;
  detail: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface PgGroupLead {
  id: string;
  account_id: string | null;
  group_id: string | null;
  group_jid: string;
  group_name: string;
  phone: string;
  name: string | null;
  is_admin: boolean;
  added_at: string | null;
  created_at: string;
}

export interface PgSettings {
  id?: string;
  user_id?: string;
  default_interval_min: number;
  default_interval_max: number;
  anti_ban: boolean;
  daily_limit: number;
}

export const STATUS_LABEL: Record<CampaignStatus, string> = {
  rascunho: "Rascunho",
  agendada: "Agendada",
  enviando: "Enviando",
  pausada: "Pausada",
  concluida: "Concluída",
  falhou: "Falhou",
};

export const STATUS_CLASSE: Record<CampaignStatus, string> = {
  rascunho: "bg-muted text-muted-foreground",
  agendada: "bg-sky-500/10 text-sky-600",
  enviando: "bg-amber-500/10 text-amber-600",
  pausada: "bg-orange-500/10 text-orange-600",
  concluida: "bg-emerald-500/10 text-emerald-600",
  falhou: "bg-red-500/10 text-red-600",
};

/** Registra uma linha no feed de atividades. Silencioso: nunca quebra a ação
 *  principal por falha de log. */
export async function logActivity(input: {
  type: string;
  title: string;
  detail?: string;
  campaign_id?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return;
    await (supabase as any).from("pg_activities").insert({
      user_id: uid,
      campaign_id: input.campaign_id ?? null,
      type: input.type,
      title: input.title,
      detail: input.detail ?? null,
      metadata: input.metadata ?? null,
    });
  } catch {
    /* log é best-effort */
  }
}
