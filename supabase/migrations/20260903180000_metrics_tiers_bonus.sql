ALTER TABLE public.metrics_tiers
  ADD COLUMN IF NOT EXISTS bonus_value numeric(12,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.metrics_tiers.bonus_value IS
  'Valor fixo somado à comissão do vendedor ao alcançar este elo, além do percentual.';
