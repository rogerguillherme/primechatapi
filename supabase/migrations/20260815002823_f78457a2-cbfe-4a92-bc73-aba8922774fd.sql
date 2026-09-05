REVOKE ALL ON FUNCTION public.distribute_lead_on_inbound() FROM anon, authenticated, public;
REVOKE ALL ON FUNCTION public.distribute_lead_on_create() FROM anon, authenticated, public;
REVOKE ALL ON FUNCTION public.distribute_lead(uuid) FROM anon, public;