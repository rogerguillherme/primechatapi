ALTER TABLE public.broadcast_jobs
  ADD COLUMN IF NOT EXISTS delay_min_seconds integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS delay_max_seconds integer NOT NULL DEFAULT 5;