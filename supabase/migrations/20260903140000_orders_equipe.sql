-- Vendas visíveis para a equipe, não só para o dono da linha.
--
-- `orders` era a única tabela do Métrik cuja política ignorava equipe:
-- auth.uid() = user_id. Leads, etapas do kanban, elos, metas e taxas todas
-- usam team_access_level. O resultado é um painel de ranking em que o gerente
-- não vê venda nenhuma — e, pior, em que a mesma pessoa vê números diferentes
-- conforme a conta pela qual entrou.
--
-- Escrita continua restrita: ver o faturamento do time é uma coisa, lançar
-- venda em nome dele é outra.
DROP POLICY IF EXISTS "Users manage own orders" ON public.orders;

CREATE POLICY "Equipe lê as vendas da conta" ON public.orders
  FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR public.has_role(auth.uid(), 'admin')
    OR public.team_access_level(user_id) IS NOT NULL
  );

CREATE POLICY "Dono e gerente lançam vendas" ON public.orders
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    OR public.has_role(auth.uid(), 'admin')
    OR public.team_access_level(user_id) IN ('owner','manager')
  );

CREATE POLICY "Dono e gerente alteram vendas" ON public.orders
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = user_id
    OR public.has_role(auth.uid(), 'admin')
    OR public.team_access_level(user_id) IN ('owner','manager')
  );

CREATE POLICY "Dono e gerente removem vendas" ON public.orders
  FOR DELETE TO authenticated
  USING (
    auth.uid() = user_id
    OR public.has_role(auth.uid(), 'admin')
    OR public.team_access_level(user_id) IN ('owner','manager')
  );
