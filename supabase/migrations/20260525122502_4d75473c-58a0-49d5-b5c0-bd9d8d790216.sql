
-- Extra fields on message_logs to reflect real Meta status
ALTER TABLE public.message_logs
  ADD COLUMN IF NOT EXISTS meta_error_code text,
  ADD COLUMN IF NOT EXISTS meta_error_title text,
  ADD COLUMN IF NOT EXISTS meta_error_details text,
  ADD COLUMN IF NOT EXISTS block_severity text,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS read_at timestamptz,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_message_logs_account_status_created
  ON public.message_logs (account_id, status, created_at DESC);

-- WABA health events (locks, quality drops, spam flags, etc)
CREATE TABLE IF NOT EXISTS public.waba_health_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  account_id uuid NOT NULL,
  event_code text NOT NULL,
  event_title text NOT NULL,
  event_message text,
  severity text NOT NULL DEFAULT 'warning',
  meta_error_code text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_waba_health_events_user_unresolved
  ON public.waba_health_events (user_id, resolved_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_waba_health_events_account
  ON public.waba_health_events (account_id, created_at DESC);

ALTER TABLE public.waba_health_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own waba_health_events"
  ON public.waba_health_events FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own waba_health_events"
  ON public.waba_health_events FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service manages waba_health_events"
  ON public.waba_health_events FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Periodic snapshots of WABA health
CREATE TABLE IF NOT EXISTS public.waba_health_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  account_id uuid NOT NULL,
  quality_rating text,
  messaging_tier text,
  messaging_limit integer,
  delivery_rate_24h numeric,
  block_rate_24h numeric,
  reputation_score integer,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  captured_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_waba_health_snapshots_account_time
  ON public.waba_health_snapshots (account_id, captured_at DESC);

ALTER TABLE public.waba_health_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own waba_health_snapshots"
  ON public.waba_health_snapshots FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service manages waba_health_snapshots"
  ON public.waba_health_snapshots FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Auto-pause flags
ALTER TABLE public.broadcast_jobs
  ADD COLUMN IF NOT EXISTS auto_paused_by_system boolean NOT NULL DEFAULT false;

ALTER TABLE public.flows
  ADD COLUMN IF NOT EXISTS auto_paused_by_system boolean NOT NULL DEFAULT false;

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.waba_health_events;
