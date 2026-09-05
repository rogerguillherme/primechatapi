ALTER TABLE public.flows ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0;

WITH ordenados AS (
  SELECT id, row_number() OVER (
    PARTITION BY user_id ORDER BY active DESC, name
  ) AS pos
  FROM public.flows
)
UPDATE public.flows f SET position = o.pos
FROM ordenados o WHERE o.id = f.id;

CREATE INDEX IF NOT EXISTS idx_flows_user_position ON public.flows (user_id, position);