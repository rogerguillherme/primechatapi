-- Taxas por plataforma e base de cálculo configurável.

-- De onde a venda veio. Sem isto, taxa por plataforma não tem como ser
-- aplicada: dá para configurar "Applyfy Pix 3% + R$2,49" e não haver como
-- saber quais vendas são da Applyfy.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS platform text;

COMMENT ON COLUMN public.orders.platform IS
  'Plataforma de origem (hubla, applyfy, manual, importacao...). Usada para casar a taxa.';

CREATE INDEX IF NOT EXISTS idx_orders_platform ON public.orders (platform)
  WHERE platform IS NOT NULL;

-- Uma linha por combinação plataforma × meio de pagamento.
-- percent E fixed porque as duas cobranças coexistem: "3% + R$ 2,49".
CREATE TABLE IF NOT EXISTS public.metrics_platform_fees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  platform text NOT NULL,
  -- Nulo = vale para qualquer meio dessa plataforma.
  payment_method text,
  percent numeric(5,2) NOT NULL DEFAULT 0,
  fixed numeric(10,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, platform, payment_method)
);

CREATE INDEX IF NOT EXISTS idx_metrics_platform_fees_owner
  ON public.metrics_platform_fees (owner_id);

-- O que sai do faturamento antes de comissionar. Cada empresa combina
-- diferente com o time, então é escolha e não regra fixa.
ALTER TABLE public.metrics_settings
  ADD COLUMN IF NOT EXISTS deduct_fees boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS deduct_refunds boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS deduct_ads boolean NOT NULL DEFAULT false,
  -- 'faturamento' | 'base' | 'lucro' — sobre o que o elo é medido.
  ADD COLUMN IF NOT EXISTS tier_base text NOT NULL DEFAULT 'faturamento';

COMMENT ON COLUMN public.metrics_settings.deduct_ads IS
  'Descontar anúncio da base. Desligado por padrão: o vendedor não escolhe quanto se gasta em tráfego.';
COMMENT ON COLUMN public.metrics_settings.tier_base IS
  'Sobre qual valor o elo é medido: faturamento, base de comissão ou lucro.';

ALTER TABLE public.metrics_platform_fees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "team reads platform fees" ON public.metrics_platform_fees;
CREATE POLICY "team reads platform fees" ON public.metrics_platform_fees
  FOR SELECT TO authenticated
  USING (public.team_access_level(owner_id) IS NOT NULL);

DROP POLICY IF EXISTS "managers write platform fees" ON public.metrics_platform_fees;
CREATE POLICY "managers write platform fees" ON public.metrics_platform_fees
  FOR ALL TO authenticated
  USING (public.team_access_level(owner_id) IN ('owner','manager'))
  WITH CHECK (public.team_access_level(owner_id) IN ('owner','manager'));
