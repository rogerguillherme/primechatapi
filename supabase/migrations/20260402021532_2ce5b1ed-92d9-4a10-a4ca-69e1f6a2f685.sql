
-- Add user_id to flows table
ALTER TABLE public.flows ADD COLUMN user_id uuid DEFAULT NULL;

-- Add user_id to flow_steps (inherit from flow, but useful for RLS)
-- Actually flow_steps are accessed via flow_id, so we scope flows only.

-- Update RLS on flows: users can only see their own flows
DROP POLICY IF EXISTS "Authenticated users can manage flows" ON public.flows;

CREATE POLICY "Users can view own flows"
  ON public.flows FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own flows"
  ON public.flows FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own flows"
  ON public.flows FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own flows"
  ON public.flows FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Update flow_steps RLS to only allow access if user owns the flow
DROP POLICY IF EXISTS "Authenticated users can manage flow_steps" ON public.flow_steps;

CREATE POLICY "Users can manage own flow_steps"
  ON public.flow_steps FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.flows WHERE flows.id = flow_steps.flow_id AND flows.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.flows WHERE flows.id = flow_steps.flow_id AND flows.user_id = auth.uid()));

-- Update flow_executions RLS similarly
DROP POLICY IF EXISTS "Authenticated users can manage flow_executions" ON public.flow_executions;

CREATE POLICY "Users can manage own flow_executions"
  ON public.flow_executions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.flows WHERE flows.id = flow_executions.flow_id AND flows.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.flows WHERE flows.id = flow_executions.flow_id AND flows.user_id = auth.uid()));

-- Backfill existing flows with the current admin user
UPDATE public.flows SET user_id = '36dc3223-cbef-4a16-964b-ff5519f8f0cd' WHERE user_id IS NULL;

-- Now make user_id NOT NULL
ALTER TABLE public.flows ALTER COLUMN user_id SET NOT NULL;
