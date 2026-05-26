
-- Fase 1.1: Auto Unsubscribe Engine

-- Colunas em leads
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS unsubscribed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS unsubscribed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS unsubscribe_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_leads_unsubscribed ON public.leads(user_id, unsubscribed) WHERE unsubscribed = true;

-- Tabela de logs de unsubscribe
CREATE TABLE IF NOT EXISTS public.unsubscribe_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  lead_id UUID,
  phone TEXT NOT NULL,
  keyword_matched TEXT,
  source_message TEXT,
  source TEXT NOT NULL DEFAULT 'whatsapp_inbound',
  account_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.unsubscribe_logs TO authenticated;
GRANT ALL ON public.unsubscribe_logs TO service_role;

ALTER TABLE public.unsubscribe_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own unsubscribe_logs"
  ON public.unsubscribe_logs FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service can manage unsubscribe_logs"
  ON public.unsubscribe_logs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_unsubscribe_logs_user_created ON public.unsubscribe_logs(user_id, created_at DESC);

-- Flag global para resposta automática
INSERT INTO public.app_settings (key, value)
VALUES ('unsubscribe_auto_reply_enabled', 'true')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.app_settings (key, value)
VALUES ('unsubscribe_auto_reply_text', 'Você foi removido da lista. 👍')
ON CONFLICT (key) DO NOTHING;
