ALTER TABLE public.flow_steps
  ADD COLUMN IF NOT EXISTS ai_agent_id uuid REFERENCES public.ai_agents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ai_prompt text,
  ADD COLUMN IF NOT EXISTS max_interactions integer DEFAULT 5;