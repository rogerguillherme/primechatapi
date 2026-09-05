DROP POLICY IF EXISTS "Authenticated can manage app_settings" ON public.app_settings;

REVOKE EXECUTE ON FUNCTION public.team_access_level(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.team_lead_scope(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.distribute_lead(uuid) FROM anon, authenticated;