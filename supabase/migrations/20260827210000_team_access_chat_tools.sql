-- A atendente não conseguia trabalhar no chat.
--
-- `flows`, `flow_steps`, `flow_executions`, `chat_shortcuts` e `chat_templates`
-- ficaram todas presas a `auth.uid() = user_id`, do tempo em que só o dono
-- usava o sistema. Para quem entra como colaborador isso significa: nenhum
-- fluxo na lista, nenhum atalho ao digitar "/", nenhum template para enviar —
-- e nem como iniciar ou parar um fluxo numa conversa.
--
-- Mesmo desenho já usado em `pipeline_stages` e nas etiquetas: a equipe
-- enxerga o catálogo, dono e gerente é quem constrói. Montar fluxo é
-- configuração; usar fluxo numa conversa é o trabalho do dia.

-- ── flows: o catálogo ──
DROP POLICY IF EXISTS "Users can view own flows" ON public.flows;
DROP POLICY IF EXISTS "Users can insert own flows" ON public.flows;
DROP POLICY IF EXISTS "Users can update own flows" ON public.flows;
DROP POLICY IF EXISTS "Users can delete own flows" ON public.flows;

CREATE POLICY "Team can view flows"
  ON public.flows FOR SELECT TO authenticated
  USING (public.team_access_level(user_id) IS NOT NULL);

CREATE POLICY "Owners and managers can insert flows"
  ON public.flows FOR INSERT TO authenticated
  WITH CHECK (public.team_access_level(user_id) IN ('owner','manager'));

CREATE POLICY "Owners and managers can update flows"
  ON public.flows FOR UPDATE TO authenticated
  USING (public.team_access_level(user_id) IN ('owner','manager'))
  WITH CHECK (public.team_access_level(user_id) IN ('owner','manager'));

CREATE POLICY "Owners and managers can delete flows"
  ON public.flows FOR DELETE TO authenticated
  USING (public.team_access_level(user_id) IN ('owner','manager'));

-- ── flow_steps: as etapas ──
-- Leitura para a equipe porque iniciar um fluxo exige ler a primeira etapa
-- (ver startFlowForLead). Sem isso a atendente veria o fluxo e receberia
-- "Fluxo sem etapas" ao clicar.
DROP POLICY IF EXISTS "Users can manage own flow_steps" ON public.flow_steps;

CREATE POLICY "Team can view flow_steps"
  ON public.flow_steps FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.flows f
    WHERE f.id = flow_steps.flow_id
      AND public.team_access_level(f.user_id) IS NOT NULL
  ));

CREATE POLICY "Owners and managers can write flow_steps"
  ON public.flow_steps FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.flows f
    WHERE f.id = flow_steps.flow_id
      AND public.team_access_level(f.user_id) IN ('owner','manager')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.flows f
    WHERE f.id = flow_steps.flow_id
      AND public.team_access_level(f.user_id) IN ('owner','manager')
  ));

-- ── flow_executions: o fluxo rodando numa conversa ──
-- Acompanha o acesso ao LEAD, não só ao fluxo: quem só enxerga os leads
-- atribuídos a si não pode disparar fluxo em conversa alheia.
DROP POLICY IF EXISTS "Users can manage own flow_executions" ON public.flow_executions;

CREATE POLICY "Team can manage flow_executions"
  ON public.flow_executions FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = flow_executions.lead_id
      AND public.team_access_level(l.user_id) IN ('owner','manager','chat','broadcast')
      AND (
        public.team_lead_scope(l.user_id) = 'all'
        OR (public.team_lead_scope(l.user_id) = 'assigned' AND l.assigned_to = auth.uid())
      )
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = flow_executions.lead_id
      AND public.team_access_level(l.user_id) IN ('owner','manager','chat','broadcast')
      AND (
        public.team_lead_scope(l.user_id) = 'all'
        OR (public.team_lead_scope(l.user_id) = 'assigned' AND l.assigned_to = auth.uid())
      )
  ));

-- ── chat_shortcuts: os comandos "/" ──
DROP POLICY IF EXISTS "Users manage their own chat shortcuts" ON public.chat_shortcuts;

CREATE POLICY "Team can view chat_shortcuts"
  ON public.chat_shortcuts FOR SELECT TO authenticated
  USING (public.team_access_level(user_id) IS NOT NULL);

CREATE POLICY "Owners and managers can write chat_shortcuts"
  ON public.chat_shortcuts FOR ALL TO authenticated
  USING (public.team_access_level(user_id) IN ('owner','manager'))
  WITH CHECK (public.team_access_level(user_id) IN ('owner','manager'));

-- ── chat_templates: os modelos de mensagem ──
DROP POLICY IF EXISTS "Users can view own templates" ON public.chat_templates;
DROP POLICY IF EXISTS "Users can insert own templates" ON public.chat_templates;
DROP POLICY IF EXISTS "Users can update own templates" ON public.chat_templates;
DROP POLICY IF EXISTS "Users can delete own templates" ON public.chat_templates;

CREATE POLICY "Team can view chat_templates"
  ON public.chat_templates FOR SELECT TO authenticated
  USING (public.team_access_level(user_id) IS NOT NULL);

CREATE POLICY "Owners and managers can insert chat_templates"
  ON public.chat_templates FOR INSERT TO authenticated
  WITH CHECK (public.team_access_level(user_id) IN ('owner','manager'));

CREATE POLICY "Owners and managers can update chat_templates"
  ON public.chat_templates FOR UPDATE TO authenticated
  USING (public.team_access_level(user_id) IN ('owner','manager'))
  WITH CHECK (public.team_access_level(user_id) IN ('owner','manager'));

CREATE POLICY "Owners and managers can delete chat_templates"
  ON public.chat_templates FOR DELETE TO authenticated
  USING (public.team_access_level(user_id) IN ('owner','manager'));

-- A execução é procurada por lead a cada abertura de conversa.
CREATE INDEX IF NOT EXISTS idx_flow_executions_lead_status
  ON public.flow_executions (lead_id, status);
