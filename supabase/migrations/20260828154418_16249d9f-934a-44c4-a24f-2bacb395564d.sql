SELECT cron.unschedule('flow-processor-heartbeat')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'flow-processor-heartbeat');

SELECT cron.schedule(
  'flow-processor-heartbeat',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://nmcdvorpoujhbyccqjhl.supabase.co/functions/v1/flow-processor',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5tY2R2b3Jwb3VqaGJ5Y2NxamhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2MjM5MjgsImV4cCI6MjEwNDE5OTkyOH0.17IgMAcxX_CId-NV9ZV3r49TfhQ6Ic-iMmG5pzC0gFg"}'::jsonb,
    body := '{"cron":true}'::jsonb
  );
  $$
);