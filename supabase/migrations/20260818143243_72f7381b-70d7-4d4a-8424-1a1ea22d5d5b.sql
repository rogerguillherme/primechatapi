CREATE TABLE public.lead_send_dedup (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  phone text NOT NULL,
  dedup_key text NOT NULL,
  lead_id uuid,
  job_id uuid,
  template_name text,
  campaign_name text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX lead_send_dedup_unique ON public.lead_send_dedup (user_id, phone, dedup_key);
CREATE INDEX lead_send_dedup_lookup ON public.lead_send_dedup (user_id, dedup_key, phone);

GRANT SELECT, INSERT, DELETE ON public.lead_send_dedup TO authenticated;
GRANT ALL ON public.lead_send_dedup TO service_role;

ALTER TABLE public.lead_send_dedup ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own send dedup records"
ON public.lead_send_dedup FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own send dedup records"
ON public.lead_send_dedup FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own send dedup records"
ON public.lead_send_dedup FOR DELETE TO authenticated
USING (auth.uid() = user_id);