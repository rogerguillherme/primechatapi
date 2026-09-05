
-- Fix multi-tenant isolation: leads phone should be unique per user, not globally
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_phone_key;
CREATE UNIQUE INDEX IF NOT EXISTS leads_phone_user_unique ON public.leads (phone, user_id);
