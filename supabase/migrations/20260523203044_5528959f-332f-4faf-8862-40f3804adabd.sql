
CREATE TABLE IF NOT EXISTS public.webhook_debug (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'whatsapp-cloud-webhook',
  headers jsonb,
  raw_body text,
  parsed jsonb,
  notes text
);

ALTER TABLE public.webhook_debug ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view webhook_debug"
ON public.webhook_debug FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service can manage webhook_debug"
ON public.webhook_debug FOR ALL
TO service_role
USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_webhook_debug_created_at ON public.webhook_debug(created_at DESC);
