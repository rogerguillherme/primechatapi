REVOKE ALL ON FUNCTION public.team_access_level(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.team_lead_scope(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.distribute_lead(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_dashboard_stats() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_advanced_dashboard_stats(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.team_access_level(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.team_lead_scope(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_advanced_dashboard_stats(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.team_access_level(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.team_lead_scope(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO service_role;
GRANT EXECUTE ON FUNCTION public.distribute_lead(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_dashboard_stats() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_advanced_dashboard_stats(uuid) TO service_role;