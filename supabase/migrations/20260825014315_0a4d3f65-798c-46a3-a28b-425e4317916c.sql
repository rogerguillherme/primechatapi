ALTER TABLE public.flow_steps
  ADD COLUMN IF NOT EXISTS match_mode text NOT NULL DEFAULT 'exact',
  ADD COLUMN IF NOT EXISTS ai_match_description text,
  ADD COLUMN IF NOT EXISTS label_ids uuid[] NOT NULL DEFAULT '{}';

ALTER TABLE public.flow_steps
  DROP CONSTRAINT IF EXISTS flow_steps_match_mode_check;

ALTER TABLE public.flow_steps
  ADD CONSTRAINT flow_steps_match_mode_check CHECK (match_mode IN ('exact','contains','ai'));