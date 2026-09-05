CREATE TABLE public.lead_blacklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  phone text NOT NULL,
  reason text DEFAULT 'flow_blacklist',
  flow_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, phone)
);

CREATE INDEX idx_lead_blacklist_user_phone ON public.lead_blacklist(user_id, phone);

ALTER TABLE public.lead_blacklist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own blacklist" ON public.lead_blacklist
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own blacklist" ON public.lead_blacklist
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own blacklist" ON public.lead_blacklist
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Service can manage blacklist" ON public.lead_blacklist
  FOR ALL TO service_role USING (true) WITH CHECK (true);