CREATE TABLE IF NOT EXISTS public.metrics_platform_credentials (
  owner_id uuid NOT NULL,
  platform text NOT NULL,
  public_key text NOT NULL,
  secret_key text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, platform)
);

COMMENT ON TABLE public.metrics_platform_credentials IS
  'Credenciais de API por empresa. SEM policy de SELECT: só a service role lê.';

GRANT INSERT, UPDATE, DELETE ON public.metrics_platform_credentials TO authenticated;
GRANT ALL ON public.metrics_platform_credentials TO service_role;

ALTER TABLE public.metrics_platform_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "managers write credentials" ON public.metrics_platform_credentials;
CREATE POLICY "managers write credentials" ON public.metrics_platform_credentials
  FOR INSERT TO authenticated
  WITH CHECK (public.team_access_level(owner_id) IN ('owner','manager'));

DROP POLICY IF EXISTS "managers update credentials" ON public.metrics_platform_credentials;
CREATE POLICY "managers update credentials" ON public.metrics_platform_credentials
  FOR UPDATE TO authenticated
  USING (public.team_access_level(owner_id) IN ('owner','manager'));

DROP POLICY IF EXISTS "managers delete credentials" ON public.metrics_platform_credentials;
CREATE POLICY "managers delete credentials" ON public.metrics_platform_credentials
  FOR DELETE TO authenticated
  USING (public.team_access_level(owner_id) IN ('owner','manager'));

ALTER TABLE public.metrics_settings
  ADD COLUMN IF NOT EXISTS applyfy_configured_at timestamptz;