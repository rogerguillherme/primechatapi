-- Dono e gerente conseguem criar lead em nome da conta, não só o dono.
--
-- `leads` já tinha SELECT/UPDATE cientes de equipe (team_lead_scope,
-- 20260814184428), mas o INSERT ficou parado na regra antiga de single-tenant
-- (auth.uid() = user_id) — qualquer fluxo que cria lead com user_id = dono
-- (NovaVendaDialog, EditarVendaDialog ao vincular cliente numa venda sem
-- lead, importação de planilha) falha silenciosamente por RLS quando quem
-- está logado é o gerente, não o dono da conta.
DROP POLICY IF EXISTS "Users can insert own leads" ON public.leads;

CREATE POLICY "Dono e gerente inserem leads" ON public.leads
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    OR public.team_access_level(user_id) IN ('owner', 'manager')
  );
