-- O líquido que a plataforma informa.
--
-- A taxa configurada ("3% + R$ 2,49") é uma aproximação: ela erra em venda
-- parcelada, em promoção de taxa, e em qualquer regra que a plataforma mude
-- sem avisar. Mas a ApplyFy — e a maioria dos checkouts — já diz quanto sobrou
-- para o produtor em cada venda. Guardar esse número dá a taxa EXATA, venda a
-- venda, sem ninguém precisar configurar nada.
--
-- A regra configurada continua valendo como saída para plataforma que não
-- informa o líquido.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS net_amount numeric(12,2);

COMMENT ON COLUMN public.orders.net_amount IS
  'Valor que sobrou para o produtor, informado pela plataforma. amount − net_amount = taxa real. Nulo = plataforma não informou.';
