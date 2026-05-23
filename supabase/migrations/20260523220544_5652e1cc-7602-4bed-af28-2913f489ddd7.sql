
-- 1. Extend whatsapp_accounts with provisioning metadata
ALTER TABLE public.whatsapp_accounts
  ADD COLUMN IF NOT EXISTS app_id TEXT,
  ADD COLUMN IF NOT EXISTS business_id TEXT,
  ADD COLUMN IF NOT EXISTS onboarding_method TEXT,
  ADD COLUMN IF NOT EXISTS token_type TEXT,
  ADD COLUMN IF NOT EXISTS provisioned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_health_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_health_status TEXT;

-- Backfill legacy accounts
UPDATE public.whatsapp_accounts
SET onboarding_method = 'legacy',
    token_type = COALESCE(token_type, 'legacy'),
    last_health_status = COALESCE(last_health_status, 'pending_migration')
WHERE onboarding_method IS NULL;

-- Constraint on onboarding_method
ALTER TABLE public.whatsapp_accounts
  DROP CONSTRAINT IF EXISTS whatsapp_accounts_onboarding_method_check;
ALTER TABLE public.whatsapp_accounts
  ADD CONSTRAINT whatsapp_accounts_onboarding_method_check
  CHECK (onboarding_method IN ('embedded_signup','legacy','superseded'));

-- Global unique phone_number_id (skip if duplicates exist; create partial unique to avoid migration failures)
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_accounts_phone_number_id_unique
  ON public.whatsapp_accounts(phone_number_id)
  WHERE phone_number_id IS NOT NULL AND phone_number_id <> '';

-- 2. Onboarding sessions for Embedded Signup
CREATE TABLE IF NOT EXISTS public.whatsapp_onboarding_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  state TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
ALTER TABLE public.whatsapp_onboarding_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own onboarding sessions" ON public.whatsapp_onboarding_sessions;
CREATE POLICY "Users manage own onboarding sessions"
  ON public.whatsapp_onboarding_sessions
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service manages onboarding sessions" ON public.whatsapp_onboarding_sessions;
CREATE POLICY "Service manages onboarding sessions"
  ON public.whatsapp_onboarding_sessions
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 3. Dead letter for unmapped inbound webhooks
CREATE TABLE IF NOT EXISTS public.whatsapp_dead_letter (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number_id TEXT,
  waba_id TEXT,
  display_phone_number TEXT,
  reason TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS whatsapp_dead_letter_phone_idx
  ON public.whatsapp_dead_letter(phone_number_id);
CREATE INDEX IF NOT EXISTS whatsapp_dead_letter_created_idx
  ON public.whatsapp_dead_letter(created_at DESC);

ALTER TABLE public.whatsapp_dead_letter ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins view dead letter" ON public.whatsapp_dead_letter;
CREATE POLICY "Admins view dead letter"
  ON public.whatsapp_dead_letter
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Service manages dead letter" ON public.whatsapp_dead_letter;
CREATE POLICY "Service manages dead letter"
  ON public.whatsapp_dead_letter
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 4. Audit log for token / provisioning / healthcheck events
CREATE TABLE IF NOT EXISTS public.whatsapp_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID,
  user_id UUID,
  event TEXT NOT NULL,
  flags TEXT[] NOT NULL DEFAULT '{}',
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS whatsapp_audit_log_account_idx
  ON public.whatsapp_audit_log(account_id);
CREATE INDEX IF NOT EXISTS whatsapp_audit_log_user_idx
  ON public.whatsapp_audit_log(user_id);
CREATE INDEX IF NOT EXISTS whatsapp_audit_log_created_idx
  ON public.whatsapp_audit_log(created_at DESC);

ALTER TABLE public.whatsapp_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins view audit log" ON public.whatsapp_audit_log;
CREATE POLICY "Admins view audit log"
  ON public.whatsapp_audit_log
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Users view own audit log" ON public.whatsapp_audit_log;
CREATE POLICY "Users view own audit log"
  ON public.whatsapp_audit_log
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service manages audit log" ON public.whatsapp_audit_log;
CREATE POLICY "Service manages audit log"
  ON public.whatsapp_audit_log
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 5. Trigger to keep updated_at fresh on onboarding sessions
DROP TRIGGER IF EXISTS update_whatsapp_onboarding_sessions_updated_at ON public.whatsapp_onboarding_sessions;
CREATE TRIGGER update_whatsapp_onboarding_sessions_updated_at
  BEFORE UPDATE ON public.whatsapp_onboarding_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
