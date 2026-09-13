-- Vendas do Métrik respeitando o escopo do colaborador ("assigned"), não só
-- se ele tem qualquer acesso à conta.
--
-- A migration 20260903140000_orders_equipe.sql corrigiu o gerente não ver
-- venda nenhuma, mas foi longe demais na direção oposta: qualquer membro da
-- equipe (mesmo lead_scope = 'assigned', que no CRM só vê os próprios leads)
-- lia TODAS as vendas da conta em `orders`. Mesmo padrão de
-- `team_lead_scope` já usado em `leads`/`chat_messages`: dono, admin e
-- lead_scope='all' continuam vendo tudo; lead_scope='assigned' só vê a venda
-- cujo lead está atribuído a ele.
--
-- Venda sem lead_id (nunca vinculada a um contato) não aparece pra quem tem
-- escopo 'assigned' — não há como ela ser "dele" sem lead.
DROP POLICY IF EXISTS "Equipe lê as vendas da conta" ON public.orders;

CREATE POLICY "Equipe le as vendas conforme o escopo" ON public.orders
  FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR public.has_role(auth.uid(), 'admin')
    OR public.team_lead_scope(user_id) = 'all'
    OR (
      public.team_lead_scope(user_id) = 'assigned'
      AND EXISTS (
        SELECT 1 FROM public.leads l
        WHERE l.id = orders.lead_id AND l.assigned_to = auth.uid()
      )
    )
  );
