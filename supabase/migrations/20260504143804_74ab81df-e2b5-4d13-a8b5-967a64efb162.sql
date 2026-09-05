ALTER TABLE public.flow_steps ADD COLUMN IF NOT EXISTS is_entry boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_flow_steps_entry ON public.flow_steps (flow_id, is_entry, step_order);