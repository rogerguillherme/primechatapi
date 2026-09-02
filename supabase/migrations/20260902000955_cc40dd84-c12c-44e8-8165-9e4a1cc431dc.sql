-- Custo de anúncio do período, para ROI e ROAS.
--
-- Entrada manual por enquanto. A Meta Marketing API é a fase 5 do plano, e
-- ROI/ROAS não precisam esperar por ela: o número que falta é um só, e quem
-- roda tráfego já o tem à mão. Quando a integração entrar, ela preenche esta
-- mesma tabela e nada na tela muda.
--
-- member_user_id nulo = gasto da empresa inteira, não atribuído a um vendedor.
-- É o caso comum de quem anuncia sem link por vendedor.
CREATE TABLE IF NOT EXISTS public.metrics_ad_spend (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  member_user_id uuid,
  period_start date NOT NULL,
  period_end date NOT NULL,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.metrics_ad_spend.member_user_id IS
  'Vendedor a quem o gasto é atribuído. Nulo = gasto da empresa, sem atribuição.';
COMMENT ON COLUMN public.metrics_ad_spend.source IS
  'De onde veio o número: manual, ou a integração que o preencheu.';

CREATE INDEX IF NOT EXISTS idx_metrics_ad_spend_owner_period
  ON public.metrics_ad_spend (owner_id, period_start, period_end);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.metrics_ad_spend TO authenticated;
GRANT ALL ON public.metrics_ad_spend TO service_role;

ALTER TABLE public.metrics_ad_spend ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "team reads ad spend" ON public.metrics_ad_spend;
CREATE POLICY "team reads ad spend" ON public.metrics_ad_spend
  FOR SELECT TO authenticated
  USING (public.team_access_level(owner_id) IS NOT NULL);

DROP POLICY IF EXISTS "managers write ad spend" ON public.metrics_ad_spend;
CREATE POLICY "managers write ad spend" ON public.metrics_ad_spend
  FOR INSERT TO authenticated
  WITH CHECK (public.team_access_level(owner_id) IN ('owner','manager'));

DROP POLICY IF EXISTS "managers update ad spend" ON public.metrics_ad_spend;
CREATE POLICY "managers update ad spend" ON public.metrics_ad_spend
  FOR UPDATE TO authenticated
  USING (public.team_access_level(owner_id) IN ('owner','manager'));

DROP POLICY IF EXISTS "managers delete ad spend" ON public.metrics_ad_spend;
CREATE POLICY "managers delete ad spend" ON public.metrics_ad_spend
  FOR DELETE TO authenticated
  USING (public.team_access_level(owner_id) IN ('owner','manager'));