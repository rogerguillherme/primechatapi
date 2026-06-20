CREATE TABLE IF NOT EXISTS public.instagram_comment_automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  connection_id uuid NOT NULL REFERENCES public.instagram_connections(id) ON DELETE CASCADE,
  automation_id uuid NOT NULL REFERENCES public.instagram_automations(id) ON DELETE CASCADE,
  comment_id text NOT NULL,
  media_id text,
  commenter_id text,
  commenter_username text,
  comment_text text,
  status text NOT NULL DEFAULT 'processed',
  step_results jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text,
  processed_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, comment_id, automation_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.instagram_comment_automation_runs TO authenticated;
GRANT ALL ON public.instagram_comment_automation_runs TO service_role;

ALTER TABLE public.instagram_comment_automation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own instagram comment runs"
ON public.instagram_comment_automation_runs
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own instagram comment runs"
ON public.instagram_comment_automation_runs
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_ig_comment_runs_user_comment
ON public.instagram_comment_automation_runs(user_id, comment_id);

CREATE INDEX IF NOT EXISTS idx_ig_comment_runs_connection_processed
ON public.instagram_comment_automation_runs(connection_id, processed_at DESC);

SELECT cron.unschedule('instagram-auto-reply-comments-cron')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'instagram-auto-reply-comments-cron');

SELECT cron.schedule(
  'instagram-auto-reply-comments-cron',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://nnjwemmerumzkiiykpas.supabase.co/functions/v1/instagram-auto-reply-comments',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJIUzI1NiIsInJlZiI6Im5uandlbW1lcnVtemtpaXlrcGFzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1NDEwNDcsImV4cCI6MjA4NzExNzA0N30._GKCqMhMBR3j0jK438raMweCb2Bf_LMs-BuCwAPLQ48"}'::jsonb,
    body := '{"cron":true,"max_posts":10,"max_comments_per_post":25}'::jsonb
  );
  $$
);