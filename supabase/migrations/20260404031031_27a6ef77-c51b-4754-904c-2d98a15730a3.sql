
-- Table to track broadcast jobs for background processing
CREATE TABLE public.broadcast_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES public.whatsapp_accounts(id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.chat_templates(id) ON DELETE SET NULL,
  template_name text,
  template_language text DEFAULT 'pt_BR',
  template_params jsonb DEFAULT '[]'::jsonb,
  lead_ids uuid[] NOT NULL DEFAULT '{}',
  total_leads integer NOT NULL DEFAULT 0,
  sent_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  delivered_count integer NOT NULL DEFAULT 0,
  read_count integer NOT NULL DEFAULT 0,
  last_cursor integer NOT NULL DEFAULT 0,
  retry_map jsonb DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.broadcast_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own broadcast_jobs"
  ON public.broadcast_jobs FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own broadcast_jobs"
  ON public.broadcast_jobs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own broadcast_jobs"
  ON public.broadcast_jobs FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own broadcast_jobs"
  ON public.broadcast_jobs FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Enable realtime for progress monitoring
ALTER PUBLICATION supabase_realtime ADD TABLE public.broadcast_jobs;
