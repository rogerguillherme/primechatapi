CREATE TABLE public.instagram_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  connection_id uuid,
  entry_id text,
  event_type text NOT NULL DEFAULT 'unknown',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed boolean NOT NULL DEFAULT false,
  error text,
  attempts integer NOT NULL DEFAULT 0,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX idx_igwe_user_received ON public.instagram_webhook_events(user_id, received_at DESC);
CREATE INDEX idx_igwe_failed ON public.instagram_webhook_events(processed, received_at DESC) WHERE processed = false;

ALTER TABLE public.instagram_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service manages ig webhook events"
ON public.instagram_webhook_events FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Users view own ig webhook events"
ON public.instagram_webhook_events FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users update own ig webhook events"
ON public.instagram_webhook_events FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users delete own ig webhook events"
ON public.instagram_webhook_events FOR DELETE TO authenticated USING (auth.uid() = user_id);