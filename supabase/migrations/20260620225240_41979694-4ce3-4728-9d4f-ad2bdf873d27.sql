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