-- 20260729121249 reopened app_settings to every authenticated user, which now
-- includes public /teste-gratis trial signups. app_settings holds global
-- secrets (whatsapp_verify_token) and config (antiban_v2_enforce_mode,
-- ai_auto_reply_mode) that trial accounts must not read or overwrite.
-- Real team accounts (admin-created, trial_ends_at IS NULL) keep access.
DROP POLICY IF EXISTS "Authenticated can manage app_settings" ON public.app_settings;

CREATE POLICY "Non-trial users can manage app_settings" ON public.app_settings
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.user_id = auth.uid() AND profiles.trial_ends_at IS NULL
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.user_id = auth.uid() AND profiles.trial_ends_at IS NULL
    )
  );
