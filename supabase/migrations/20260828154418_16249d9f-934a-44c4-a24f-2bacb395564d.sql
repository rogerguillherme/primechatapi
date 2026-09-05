SELECT cron.unschedule('flow-processor-heartbeat')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'flow-processor-heartbeat');

SELECT cron.schedule(
  'flow-processor-heartbeat',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://nnjwemmerumzkiiykpas.supabase.co/functions/v1/flow-processor',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5uandlbW1lcnVtemtpaXlrcGFzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1NDEwNDcsImV4cCI6MjA4NzExNzA0N30._GKCqMhMBR3j0jK438raMweCb2Bf_LMs-BuCwAPLQ48"}'::jsonb,
    body := '{"cron":true}'::jsonb
  );
  $$
);