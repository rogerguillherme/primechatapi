CREATE TABLE IF NOT EXISTS public.whatsapp_inbound_dedup (
  message_id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.whatsapp_inbound_dedup TO service_role;
ALTER TABLE public.whatsapp_inbound_dedup ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_wa_inbound_dedup_created_at ON public.whatsapp_inbound_dedup (created_at);