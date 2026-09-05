ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS ai_agent_id uuid REFERENCES public.ai_agents(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_leads_ai_agent_id ON public.leads(ai_agent_id);