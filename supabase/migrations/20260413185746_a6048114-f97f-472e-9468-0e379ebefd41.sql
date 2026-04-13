
CREATE TABLE public.ai_agents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  identity TEXT DEFAULT '',
  guidelines TEXT DEFAULT '',
  instructions TEXT DEFAULT '',
  knowledge TEXT DEFAULT '',
  faq JSONB DEFAULT '[]'::jsonb,
  voice TEXT DEFAULT 'samuel',
  voice_stability NUMERIC DEFAULT 0.5,
  voice_similarity NUMERIC DEFAULT 0.7,
  voice_accent NUMERIC DEFAULT 0.5,
  voice_speed NUMERIC DEFAULT 1.0,
  ai_model TEXT DEFAULT 'google/gemini-3-flash-preview',
  max_interactions INTEGER DEFAULT 5,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own agents"
ON public.ai_agents
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());
