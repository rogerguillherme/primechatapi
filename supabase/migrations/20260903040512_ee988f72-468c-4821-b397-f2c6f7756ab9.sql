ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS net_amount numeric(12,2);

COMMENT ON COLUMN public.orders.net_amount IS
  'Valor que sobrou para o produtor, informado pela plataforma. amount − net_amount = taxa real. Nulo = plataforma não informou.';