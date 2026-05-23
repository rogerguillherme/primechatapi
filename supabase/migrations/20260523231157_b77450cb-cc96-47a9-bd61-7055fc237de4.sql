
ALTER TABLE public.whatsapp_accounts
  ADD COLUMN IF NOT EXISTS meta_user_id text,
  ADD COLUMN IF NOT EXISTS webhook_subscribed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS webhook_subscribed_at timestamptz,
  ADD COLUMN IF NOT EXISTS webhook_last_check_at timestamptz,
  ADD COLUMN IF NOT EXISTS webhook_last_status text,
  ADD COLUMN IF NOT EXISTS token_validity text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS token_app_id text,
  ADD COLUMN IF NOT EXISTS token_checked_at timestamptz;

CREATE TABLE IF NOT EXISTS public.whatsapp_account_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES public.whatsapp_accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  event text NOT NULL,
  status text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_account_audit_account_idx
  ON public.whatsapp_account_audit(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_account_audit_user_idx
  ON public.whatsapp_account_audit(user_id, created_at DESC);

ALTER TABLE public.whatsapp_account_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service manages whatsapp_account_audit" ON public.whatsapp_account_audit;
CREATE POLICY "Service manages whatsapp_account_audit"
  ON public.whatsapp_account_audit
  FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users read own whatsapp_account_audit" ON public.whatsapp_account_audit;
CREATE POLICY "Users read own whatsapp_account_audit"
  ON public.whatsapp_account_audit
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
