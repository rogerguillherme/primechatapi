
CREATE TABLE public.ai_agent_feedback (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id UUID NOT NULL REFERENCES public.ai_agents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  user_message TEXT NOT NULL,
  bad_reply TEXT,
  good_reply TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_agent_feedback_agent ON public.ai_agent_feedback(agent_id);

ALTER TABLE public.ai_agent_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own agent feedback"
  ON public.ai_agent_feedback FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service manages all agent feedback"
  ON public.ai_agent_feedback FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
