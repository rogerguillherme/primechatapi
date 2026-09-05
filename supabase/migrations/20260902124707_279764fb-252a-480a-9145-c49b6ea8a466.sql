-- Configuração do Metrik por empresa.
--
-- A comissão não pode sair do faturamento cru: a plataforma de checkout retém
-- a taxa dela antes de o dinheiro chegar, e reembolso é dinheiro que voltou.
-- Comissionar sobre o valor bruto paga o vendedor por dinheiro que a empresa
-- não recebeu — e o erro só aparece no fim do mês, no extrato.
--
-- Uma linha por empresa. `commission_pct` é o percentual usado quando não há
-- elo alcançado; havendo elo, vale o percentual dele.
CREATE TABLE IF NOT EXISTS public.metrics_settings (
  owner_id uuid PRIMARY KEY,
  platform_fee_pct numeric(5,2) NOT NULL DEFAULT 0,
  commission_pct numeric(5,2) NOT NULL DEFAULT 10,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.metrics_settings.platform_fee_pct IS
  'Taxa média da plataforma de checkout, em %. Descontada antes de comissionar.';
COMMENT ON COLUMN public.metrics_settings.commission_pct IS
  'Percentual de comissão padrão, usado quando o vendedor não alcançou elo nenhum.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.metrics_settings TO authenticated;
GRANT ALL ON public.metrics_settings TO service_role;

ALTER TABLE public.metrics_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "team reads metrics settings" ON public.metrics_settings;
CREATE POLICY "team reads metrics settings" ON public.metrics_settings
  FOR SELECT TO authenticated
  USING (public.team_access_level(owner_id) IS NOT NULL);

DROP POLICY IF EXISTS "managers write metrics settings" ON public.metrics_settings;
CREATE POLICY "managers write metrics settings" ON public.metrics_settings
  FOR INSERT TO authenticated
  WITH CHECK (public.team_access_level(owner_id) IN ('owner','manager'));

DROP POLICY IF EXISTS "managers update metrics settings" ON public.metrics_settings;
CREATE POLICY "managers update metrics settings" ON public.metrics_settings
  FOR UPDATE TO authenticated
  USING (public.team_access_level(owner_id) IN ('owner','manager'));