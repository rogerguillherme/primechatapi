
-- ============================================
-- FASE 1: Adicionar user_id a chat_templates
-- ============================================
ALTER TABLE public.chat_templates ADD COLUMN IF NOT EXISTS user_id uuid;

-- Atribuir user_id aos templates existentes baseado na conta WhatsApp vinculada
UPDATE public.chat_templates ct
SET user_id = sub.user_id
FROM (
  SELECT DISTINCT ON (at2.template_id) at2.template_id, wa.user_id
  FROM account_templates at2
  JOIN whatsapp_accounts wa ON wa.id = at2.account_id
  WHERE wa.user_id IS NOT NULL
  ORDER BY at2.template_id, at2.created_at ASC
) sub
WHERE ct.id = sub.template_id AND ct.user_id IS NULL;

-- Templates órfãos (sem conta vinculada) atribuir ao admin
UPDATE public.chat_templates SET user_id = '36dc3223-cbef-4a16-964b-ff5519f8f0cd' WHERE user_id IS NULL;

-- ============================================
-- FASE 2: Corrigir RLS de chat_templates
-- ============================================
DROP POLICY IF EXISTS "Authenticated users can manage chat_templates" ON public.chat_templates;

CREATE POLICY "Users can view own templates" ON public.chat_templates
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own templates" ON public.chat_templates
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own templates" ON public.chat_templates
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own templates" ON public.chat_templates
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Service can manage all templates" ON public.chat_templates
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================
-- FASE 3: Corrigir RLS de account_templates
-- ============================================
DROP POLICY IF EXISTS "Authenticated users can manage account_templates" ON public.account_templates;

CREATE POLICY "Users can manage own account_templates" ON public.account_templates
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM whatsapp_accounts wa WHERE wa.id = account_templates.account_id AND wa.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM whatsapp_accounts wa WHERE wa.id = account_templates.account_id AND wa.user_id = auth.uid()
  ));

CREATE POLICY "Service can manage all account_templates" ON public.account_templates
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================
-- FASE 4: Corrigir RLS de app_settings
-- ============================================
DROP POLICY IF EXISTS "Allow all access to app_settings" ON public.app_settings;

CREATE POLICY "Admins can manage app_settings" ON public.app_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated can read app_settings" ON public.app_settings
  FOR SELECT TO authenticated USING (true);

-- ============================================
-- FASE 5: Corrigir RLS de chat_labels
-- ============================================
DROP POLICY IF EXISTS "Authenticated users can manage chat_labels" ON public.chat_labels;

CREATE POLICY "Users can manage own chat_labels" ON public.chat_labels
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================
-- FASE 6: Corrigir RLS de lead_labels
-- ============================================
DROP POLICY IF EXISTS "Authenticated users can manage lead_labels" ON public.lead_labels;

CREATE POLICY "Users can manage own lead_labels" ON public.lead_labels
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM leads WHERE leads.id = lead_labels.lead_id AND leads.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM leads WHERE leads.id = lead_labels.lead_id AND leads.user_id = auth.uid()
  ));

-- ============================================
-- FASE 7: Corrigir RLS de webhook_logs
-- ============================================
DROP POLICY IF EXISTS "Authenticated users can manage webhook_logs" ON public.webhook_logs;

CREATE POLICY "Authenticated can read webhook_logs" ON public.webhook_logs
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Service can manage webhook_logs" ON public.webhook_logs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================
-- FASE 8: Tabela de notificações
-- ============================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  type text NOT NULL DEFAULT 'info',
  title text NOT NULL,
  message text,
  link text,
  read boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications" ON public.notifications
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications" ON public.notifications
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own notifications" ON public.notifications
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Service can manage all notifications" ON public.notifications
  FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications (user_id, read) WHERE read = false;

-- ============================================
-- FASE 9: Tabela de audit logs
-- ============================================
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  action text NOT NULL,
  table_name text,
  record_id text,
  details jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all audit_logs" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can view own audit_logs" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service can manage audit_logs" ON public.audit_logs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON public.audit_logs (user_id, created_at DESC);

-- ============================================
-- FASE 10: Agendamento de disparos
-- ============================================
ALTER TABLE public.broadcast_jobs ADD COLUMN IF NOT EXISTS scheduled_at timestamp with time zone;

-- ============================================
-- FASE 11: Função de dashboard avançado
-- ============================================
CREATE OR REPLACE FUNCTION public.get_advanced_dashboard_stats(p_user_id uuid)
RETURNS TABLE(
  total_leads bigint,
  total_campaigns bigint,
  total_messages_sent bigint,
  total_delivered bigint,
  total_read bigint,
  total_errors bigint,
  avg_response_time_minutes numeric,
  response_rate numeric,
  active_flows bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    (SELECT count(*) FROM leads WHERE user_id = p_user_id),
    (SELECT count(*) FROM broadcast_jobs WHERE user_id = p_user_id),
    (SELECT coalesce(sum(sent_count), 0) FROM broadcast_jobs WHERE user_id = p_user_id),
    (SELECT coalesce(sum(delivered_count), 0) FROM broadcast_jobs WHERE user_id = p_user_id),
    (SELECT coalesce(sum(read_count), 0) FROM broadcast_jobs WHERE user_id = p_user_id),
    (SELECT coalesce(sum(error_count), 0) FROM broadcast_jobs WHERE user_id = p_user_id),
    (SELECT coalesce(round(avg(EXTRACT(EPOCH FROM (l.last_inbound_at - l.last_outbound_at)) / 60)::numeric, 1), 0)
     FROM leads l WHERE l.user_id = p_user_id AND l.last_inbound_at IS NOT NULL AND l.last_outbound_at IS NOT NULL
     AND l.last_inbound_at > l.last_outbound_at),
    (SELECT CASE WHEN count(*) = 0 THEN 0
     ELSE round(count(*) FILTER (WHERE last_inbound_at IS NOT NULL)::numeric / count(*)::numeric * 100, 1)
     END FROM leads WHERE user_id = p_user_id AND last_outbound_at IS NOT NULL),
    (SELECT count(*) FROM flows WHERE user_id = p_user_id AND active = true);
$$;
