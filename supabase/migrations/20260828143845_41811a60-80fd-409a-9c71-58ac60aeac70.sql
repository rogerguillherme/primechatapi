ALTER TABLE public.flow_steps
  ADD COLUMN IF NOT EXISTS no_response_conditions jsonb NOT NULL DEFAULT '[]'::jsonb;