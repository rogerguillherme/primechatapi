-- Batida de coração do motor de envio do Prime Group (pg-campaign-dispatch).
--
-- Mesmo problema do flow-processor: sem agendamento, uma campanha "agendada"
-- só saía do papel se alguém abrisse a tela e clicasse em algo. A cada minuto
-- é o intervalo já usado pelos outros crons do projeto.

SELECT cron.unschedule('pg-campaign-dispatch-heartbeat')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pg-campaign-dispatch-heartbeat');

SELECT cron.schedule(
  'pg-campaign-dispatch-heartbeat',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://nnjwemmerumzkiiykpas.supabase.co/functions/v1/pg-campaign-dispatch',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJIUzI1NiIsInJlZiI6Im5uandlbW1lcnVtemtpaXlrcGFzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1NDEwNDcsImV4cCI6MjA4NzExNzA0N30._GKCqMhMBR3j0jK438raMweCb2Bf_LMs-BuCwAPLQ48"}'::jsonb,
    body := '{"cron":true}'::jsonb
  );
  $$
);
