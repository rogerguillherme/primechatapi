
-- Message logs for audit/debug
CREATE TABLE public.message_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES public.broadcast_jobs(id) ON DELETE CASCADE NOT NULL,
  user_id uuid NOT NULL,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  phone text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  error_code text,
  error_message text,
  wa_message_id text,
  account_id uuid REFERENCES public.whatsapp_accounts(id) ON DELETE SET NULL,
  sent_at timestamptz DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.message_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own message_logs"
  ON public.message_logs FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own message_logs"
  ON public.message_logs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Index for fast lookups
CREATE INDEX idx_message_logs_job_id ON public.message_logs(job_id);
CREATE INDEX idx_message_logs_status ON public.message_logs(status);

-- User plan limits (SaaS control)
CREATE TABLE public.user_plan_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  max_messages_per_day integer NOT NULL DEFAULT 1000,
  max_concurrent_campaigns integer NOT NULL DEFAULT 3,
  max_contacts_per_campaign integer NOT NULL DEFAULT 10000,
  messages_sent_today integer NOT NULL DEFAULT 0,
  last_reset_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_plan_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own plan_limits"
  ON public.user_plan_limits FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own plan_limits"
  ON public.user_plan_limits FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Add smart sending columns to broadcast_jobs
ALTER TABLE public.broadcast_jobs
  ADD COLUMN IF NOT EXISTS warmup_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS warmup_daily_limit integer DEFAULT 20,
  ADD COLUMN IF NOT EXISTS warmup_day integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shuffle_leads boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS pause_reason text,
  ADD COLUMN IF NOT EXISTS consecutive_errors integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_rate numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS multi_number boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS account_ids uuid[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS messages_per_second integer NOT NULL DEFAULT 75;
