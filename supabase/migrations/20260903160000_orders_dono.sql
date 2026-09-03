-- Devolve o dono às vendas órfãs.
--
-- O hubla-webhook criava venda sem user_id, e a política de acesso é
-- `auth.uid() = user_id` — que NULL nunca satisfaz. As 699 vendas do banco
-- existiam e eram invisíveis para todo mundo, inclusive para o próprio dono:
-- sumiam do faturamento, do ranking e da comissão, sem erro em lugar nenhum.
--
-- O dono está no lead: quem atende o comprador pertence a uma conta. É de lá
-- que a venda herda.
UPDATE public.orders o
SET user_id = l.user_id
FROM public.leads l
WHERE o.lead_id = l.id
  AND o.user_id IS NULL
  AND l.user_id IS NOT NULL;

-- Marca a origem das que vieram por webhook e ficaram sem plataforma. Sem
-- isso a taxa por plataforma não tem como casar com o histórico.
UPDATE public.orders
SET platform = 'hubla'
WHERE platform IS NULL
  AND webhook_payload IS NOT NULL;

-- O que sobrar sem dono é venda cujo LEAD também está órfão — o mesmo defeito,
-- uma camada abaixo. Fica registrado para não passar despercebido.
DO $$
DECLARE orfas int;
BEGIN
  SELECT count(*) INTO orfas FROM public.orders WHERE user_id IS NULL;
  IF orfas > 0 THEN
    RAISE NOTICE 'Ainda restam % vendas sem dono: o lead delas também está sem user_id.', orfas;
  END IF;
END $$;
