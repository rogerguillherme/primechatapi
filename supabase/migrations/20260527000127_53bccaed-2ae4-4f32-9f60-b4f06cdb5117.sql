
-- =========================================
-- campaign_risk_profiles
-- =========================================
CREATE TABLE public.campaign_risk_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  template_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  sent_count integer NOT NULL DEFAULT 0,
  delivered_count integer NOT NULL DEFAULT 0,
  read_count integer NOT NULL DEFAULT 0,
  reply_count integer NOT NULL DEFAULT 0,
  unsubscribe_count integer NOT NULL DEFAULT 0,
  block_count integer NOT NULL DEFAULT 0,
  delivery_rate numeric NOT NULL DEFAULT 0,
  read_rate numeric NOT NULL DEFAULT 0,
  reply_rate numeric NOT NULL DEFAULT 0,
  unsubscribe_rate numeric NOT NULL DEFAULT 0,
  block_rate numeric NOT NULL DEFAULT 0,
  spam_signal_count integer NOT NULL DEFAULT 0,
  quality_impact_score numeric NOT NULL DEFAULT 0,
  risk_level text NOT NULL DEFAULT 'low',
  last_calculated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id)
);

CREATE INDEX idx_crp_user ON public.campaign_risk_profiles(user_id);
CREATE INDEX idx_crp_risk ON public.campaign_risk_profiles(risk_level);
CREATE INDEX idx_crp_templates ON public.campaign_risk_profiles USING GIN(template_ids);

GRANT SELECT ON public.campaign_risk_profiles TO authenticated;
GRANT ALL ON public.campaign_risk_profiles TO service_role;

ALTER TABLE public.campaign_risk_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service manages campaign_risk_profiles"
ON public.campaign_risk_profiles FOR ALL TO service_role
USING (true) WITH CHECK (true);

CREATE POLICY "Users view own campaign_risk_profiles"
ON public.campaign_risk_profiles FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE TRIGGER trg_crp_updated_at
BEFORE UPDATE ON public.campaign_risk_profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================
-- template_spam_analysis
-- =========================================
CREATE TABLE public.template_spam_analysis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  template_id uuid NOT NULL,
  spam_score integer NOT NULL DEFAULT 0,
  risk_level text NOT NULL DEFAULT 'low',
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  content_snapshot text,
  analyzed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id)
);

CREATE INDEX idx_tsa_user ON public.template_spam_analysis(user_id);
CREATE INDEX idx_tsa_risk ON public.template_spam_analysis(risk_level);

GRANT SELECT ON public.template_spam_analysis TO authenticated;
GRANT ALL ON public.template_spam_analysis TO service_role;

ALTER TABLE public.template_spam_analysis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service manages template_spam_analysis"
ON public.template_spam_analysis FOR ALL TO service_role
USING (true) WITH CHECK (true);

CREATE POLICY "Users view own template_spam_analysis"
ON public.template_spam_analysis FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users insert own template_spam_analysis"
ON public.template_spam_analysis FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own template_spam_analysis"
ON public.template_spam_analysis FOR UPDATE TO authenticated
USING (auth.uid() = user_id);

CREATE TRIGGER trg_tsa_updated_at
BEFORE UPDATE ON public.template_spam_analysis
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================
-- chat_templates: cache de spam
-- =========================================
ALTER TABLE public.chat_templates
  ADD COLUMN IF NOT EXISTS spam_score integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS spam_risk_level text NOT NULL DEFAULT 'low';

-- =========================================
-- broadcast_jobs: registro de check
-- =========================================
ALTER TABLE public.broadcast_jobs
  ADD COLUMN IF NOT EXISTS risk_check_passed boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS risk_check_reason text;

-- =========================================
-- app_settings: modo de enforcement
-- =========================================
INSERT INTO public.app_settings (key, value)
VALUES ('antiban_v2_enforce_mode', 'shadow')
ON CONFLICT (key) DO NOTHING;
