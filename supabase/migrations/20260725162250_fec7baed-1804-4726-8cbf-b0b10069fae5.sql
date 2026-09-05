
-- app_settings: restrict SELECT to admins
DROP POLICY IF EXISTS "Authenticated can read app_settings" ON public.app_settings;

-- profiles: restrict SELECT to owner
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- webhook_logs: restrict SELECT to admins
DROP POLICY IF EXISTS "Authenticated can read webhook_logs" ON public.webhook_logs;
CREATE POLICY "Admins can read webhook_logs" ON public.webhook_logs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- storage: remove overly broad chat-media policies (owner-scoped policies remain)
DROP POLICY IF EXISTS "Anyone can delete chat media" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can upload chat media" ON storage.objects;
DROP POLICY IF EXISTS "Chat media is publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Public read chat-media" ON storage.objects;

-- SECURITY DEFINER functions: revoke public/anon EXECUTE
REVOKE EXECUTE ON FUNCTION public.get_dashboard_stats() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_advanced_dashboard_stats(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_advanced_dashboard_stats(uuid) TO authenticated;

-- Trigger-only functions: revoke direct invocation
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_lead_chat_status_on_message() FROM PUBLIC, anon, authenticated;
