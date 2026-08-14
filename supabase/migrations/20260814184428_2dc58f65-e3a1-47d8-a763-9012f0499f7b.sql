-- 1. TEAM MEMBERS
CREATE TABLE public.team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  member_user_id uuid NOT NULL,
  access_level text NOT NULL DEFAULT 'chat' CHECK (access_level IN ('chat','broadcast','readonly','manager')),
  lead_scope text NOT NULL DEFAULT 'assigned' CHECK (lead_scope IN ('all','assigned')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, member_user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_members TO authenticated;
GRANT ALL ON public.team_members TO service_role;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage their team members"
ON public.team_members FOR ALL TO authenticated
USING (owner_id = auth.uid())
WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Members can view their own membership"
ON public.team_members FOR SELECT TO authenticated
USING (member_user_id = auth.uid());

CREATE POLICY "Service can manage team members"
ON public.team_members FOR ALL TO service_role
USING (true) WITH CHECK (true);

CREATE TRIGGER update_team_members_updated_at
BEFORE UPDATE ON public.team_members
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_team_members_member ON public.team_members(member_user_id);
CREATE INDEX idx_team_members_owner ON public.team_members(owner_id);

-- 2. HELPER FUNCTIONS
CREATE OR REPLACE FUNCTION public.team_access_level(_owner uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN _owner = auth.uid() THEN 'owner'
    ELSE (SELECT tm.access_level FROM public.team_members tm
          WHERE tm.owner_id = _owner AND tm.member_user_id = auth.uid() LIMIT 1)
  END
$$;

CREATE OR REPLACE FUNCTION public.team_lead_scope(_owner uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN _owner = auth.uid() THEN 'all'
    ELSE coalesce((SELECT tm.lead_scope FROM public.team_members tm
          WHERE tm.owner_id = _owner AND tm.member_user_id = auth.uid() LIMIT 1), 'none')
  END
$$;

REVOKE EXECUTE ON FUNCTION public.team_access_level(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.team_lead_scope(uuid) FROM anon;

-- 3. PIPELINE STAGES
CREATE TABLE public.pipeline_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#6366f1',
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pipeline_stages TO authenticated;
GRANT ALL ON public.pipeline_stages TO service_role;
ALTER TABLE public.pipeline_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team can view stages"
ON public.pipeline_stages FOR SELECT TO authenticated
USING (public.team_access_level(owner_id) IS NOT NULL);

CREATE POLICY "Owners and managers can insert stages"
ON public.pipeline_stages FOR INSERT TO authenticated
WITH CHECK (public.team_access_level(owner_id) IN ('owner','manager'));

CREATE POLICY "Owners and managers can update stages"
ON public.pipeline_stages FOR UPDATE TO authenticated
USING (public.team_access_level(owner_id) IN ('owner','manager'));

CREATE POLICY "Owners and managers can delete stages"
ON public.pipeline_stages FOR DELETE TO authenticated
USING (public.team_access_level(owner_id) IN ('owner','manager'));

CREATE POLICY "Service can manage stages"
ON public.pipeline_stages FOR ALL TO service_role
USING (true) WITH CHECK (true);

CREATE TRIGGER update_pipeline_stages_updated_at
BEFORE UPDATE ON public.pipeline_stages
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_pipeline_stages_owner ON public.pipeline_stages(owner_id, position);

-- 4. LEADS: stage column
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS stage_id uuid REFERENCES public.pipeline_stages(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_leads_stage ON public.leads(stage_id);
CREATE INDEX IF NOT EXISTS idx_leads_assigned_to ON public.leads(assigned_to);

-- 5. LEADS POLICIES (team aware)
DROP POLICY IF EXISTS "Users can view own leads" ON public.leads;
DROP POLICY IF EXISTS "Users can update own leads" ON public.leads;
DROP POLICY IF EXISTS "Users can delete own leads" ON public.leads;

CREATE POLICY "Team can view leads"
ON public.leads FOR SELECT TO authenticated
USING (
  public.team_lead_scope(user_id) = 'all'
  OR (public.team_lead_scope(user_id) = 'assigned' AND assigned_to = auth.uid())
);

CREATE POLICY "Team can update leads"
ON public.leads FOR UPDATE TO authenticated
USING (
  public.team_access_level(user_id) IN ('owner','manager','chat','broadcast')
  AND (
    public.team_lead_scope(user_id) = 'all'
    OR (public.team_lead_scope(user_id) = 'assigned' AND assigned_to = auth.uid())
  )
);

CREATE POLICY "Owners and managers can delete leads"
ON public.leads FOR DELETE TO authenticated
USING (public.team_access_level(user_id) IN ('owner','manager'));

-- 6. CHAT MESSAGES POLICIES (team aware)
DROP POLICY IF EXISTS "Users can view own chat_messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Users can insert own chat_messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Users can update own chat_messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Users can delete own chat_messages" ON public.chat_messages;

CREATE POLICY "Team can view chat_messages"
ON public.chat_messages FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.leads l
  WHERE l.id = chat_messages.lead_id
    AND (public.team_lead_scope(l.user_id) = 'all'
      OR (public.team_lead_scope(l.user_id) = 'assigned' AND l.assigned_to = auth.uid()))
));

CREATE POLICY "Team can insert chat_messages"
ON public.chat_messages FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM public.leads l
  WHERE l.id = chat_messages.lead_id
    AND public.team_access_level(l.user_id) IN ('owner','manager','chat','broadcast')
    AND (public.team_lead_scope(l.user_id) = 'all'
      OR (public.team_lead_scope(l.user_id) = 'assigned' AND l.assigned_to = auth.uid()))
));

CREATE POLICY "Team can update chat_messages"
ON public.chat_messages FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.leads l
  WHERE l.id = chat_messages.lead_id
    AND public.team_access_level(l.user_id) IN ('owner','manager','chat','broadcast')
));

CREATE POLICY "Owners and managers can delete chat_messages"
ON public.chat_messages FOR DELETE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.leads l
  WHERE l.id = chat_messages.lead_id
    AND public.team_access_level(l.user_id) IN ('owner','manager')
));