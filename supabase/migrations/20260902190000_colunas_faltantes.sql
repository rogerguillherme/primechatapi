-- Colunas que ficaram para trás.
--
-- As migrations anteriores rodaram parcialmente: a tabela metrics_platform_fees
-- foi criada, mas as colunas da MESMA migration não; e a de bloqueio de conta
-- não rodou. Sem elas, três coisas quebram em silêncio:
--
--   - os interruptores da base de cálculo dão erro ao salvar;
--   - taxa por plataforma não casa com venda nenhuma, porque a venda não sabe
--     de onde veio;
--   - o app segue tentando enviar por uma WABA travada, e cada tentativa é uma
--     entrega falhada contando contra a qualidade da conta.
--
-- Tudo com IF NOT EXISTS: rodar de novo não quebra nada.

ALTER TABLE public.whatsapp_accounts
  ADD COLUMN IF NOT EXISTS blocked_at timestamptz,
  ADD COLUMN IF NOT EXISTS blocked_reason text;

COMMENT ON COLUMN public.whatsapp_accounts.blocked_at IS
  'Quando a Meta recusou envio por bloqueio da conta (131031/368/131042). Nulo = liberada.';

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS platform text;

COMMENT ON COLUMN public.orders.platform IS
  'Plataforma de origem (hubla, applyfy, manual...). Usada para casar a taxa.';

CREATE INDEX IF NOT EXISTS idx_orders_platform
  ON public.orders (platform) WHERE platform IS NOT NULL;

ALTER TABLE public.metrics_settings
  ADD COLUMN IF NOT EXISTS deduct_fees boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS deduct_refunds boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS deduct_ads boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tier_base text NOT NULL DEFAULT 'faturamento';
