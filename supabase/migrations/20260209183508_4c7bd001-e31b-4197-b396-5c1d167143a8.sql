
-- Create webhook_logs table to track all incoming webhooks
CREATE TABLE public.webhook_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  external_order_id TEXT,
  event_status TEXT,
  http_status INTEGER NOT NULL DEFAULT 200,
  response_message TEXT,
  payload JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.webhook_logs ENABLE ROW LEVEL SECURITY;

-- Allow read access (restrictive with true = open, matching existing pattern)
CREATE POLICY "Authenticated users can manage webhook_logs"
ON public.webhook_logs
FOR ALL
USING (true)
WITH CHECK (true);
