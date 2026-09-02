-- Credenciais de API por empresa.
--
-- Secret do Supabase é um valor só para a plataforma inteira: serve para o
-- Prime Chat falar com a Meta, não para cada cliente falar com o checkout DELE.
-- Métrik é multiempresa, então a credencial é por dono.
--
-- A chave da ApplyFy permite SAQUE. Por isso esta tabela é ESCRITA-APENAS do
-- ponto de vista do app: não existe policy de SELECT, então nem o dono lê o
-- segredo de volta pelo PostgREST. Só a service role — dentro da edge
-- function — enxerga. Guardar o segredo e depois devolvê-lo para a tela seria
-- o mesmo que não protegê-lo.
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

ALTER TABLE public.metrics_platform_credentials ENABLE ROW LEVEL SECURITY;

-- Escrita para quem manda na conta. Leitura para ninguém.
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

-- Para a tela saber que está configurado sem poder ler o segredo. Uma coluna
-- numa tabela que já é lida evita uma view ou uma função só para isso.
ALTER TABLE public.metrics_settings
  ADD COLUMN IF NOT EXISTS applyfy_configured_at timestamptz;
