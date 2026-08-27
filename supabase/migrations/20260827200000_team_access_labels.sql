-- Etiquetas visíveis para a equipe.
--
-- `chat_labels` e `lead_labels` ficaram presas a `auth.uid() = user_id`, do
-- tempo em que só o dono usava o sistema. Com a tela de etiquetas e o botão de
-- etiqueta no chat, o colaborador via a lista vazia e não conseguia marcar
-- conversa nenhuma — a etiqueta pertence ao dono, não a ele.
--
-- Segue exatamente o desenho que `pipeline_stages` já usa: a equipe inteira
-- enxerga, mas só dono e gerente criam, editam e removem. Etiqueta é
-- configuração compartilhada; aplicar etiqueta é operação do dia a dia.

-- ── chat_labels: o catálogo ──
DROP POLICY IF EXISTS "Users can manage own chat_labels" ON public.chat_labels;

CREATE POLICY "Team can view chat_labels"
  ON public.chat_labels FOR SELECT TO authenticated
  USING (public.team_access_level(user_id) IS NOT NULL);

CREATE POLICY "Owners and managers can insert chat_labels"
  ON public.chat_labels FOR INSERT TO authenticated
  WITH CHECK (public.team_access_level(user_id) IN ('owner','manager'));

CREATE POLICY "Owners and managers can update chat_labels"
  ON public.chat_labels FOR UPDATE TO authenticated
  USING (public.team_access_level(user_id) IN ('owner','manager'))
  WITH CHECK (public.team_access_level(user_id) IN ('owner','manager'));

CREATE POLICY "Owners and managers can delete chat_labels"
  ON public.chat_labels FOR DELETE TO authenticated
  USING (public.team_access_level(user_id) IN ('owner','manager'));

-- ── lead_labels: a etiqueta aplicada a uma conversa ──
--
-- O acesso acompanha o do próprio lead, incluindo o recorte de quem só
-- enxerga os leads atribuídos a si. Sem isso, um colaborador de escopo
-- 'assigned' poderia etiquetar conversa que nem consegue abrir.
DROP POLICY IF EXISTS "Users can manage own lead_labels" ON public.lead_labels;

CREATE POLICY "Team can view lead_labels"
  ON public.lead_labels FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = lead_labels.lead_id
      AND (
        public.team_lead_scope(l.user_id) = 'all'
        OR (public.team_lead_scope(l.user_id) = 'assigned' AND l.assigned_to = auth.uid())
      )
  ));

CREATE POLICY "Team can apply lead_labels"
  ON public.lead_labels FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = lead_labels.lead_id
      AND public.team_access_level(l.user_id) IN ('owner','manager','chat','broadcast')
      AND (
        public.team_lead_scope(l.user_id) = 'all'
        OR (public.team_lead_scope(l.user_id) = 'assigned' AND l.assigned_to = auth.uid())
      )
  ));

CREATE POLICY "Team can remove lead_labels"
  ON public.lead_labels FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = lead_labels.lead_id
      AND public.team_access_level(l.user_id) IN ('owner','manager','chat','broadcast')
      AND (
        public.team_lead_scope(l.user_id) = 'all'
        OR (public.team_lead_scope(l.user_id) = 'assigned' AND l.assigned_to = auth.uid())
      )
  ));

-- A checagem de etiqueta por lead roda a cada abertura do chat.
CREATE INDEX IF NOT EXISTS idx_lead_labels_lead_id ON public.lead_labels (lead_id);
