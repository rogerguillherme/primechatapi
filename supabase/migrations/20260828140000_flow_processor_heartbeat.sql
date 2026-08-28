-- Batida de coração do processador de fluxos.
--
-- Não existia nenhum agendamento para ele. O motor dependia de duas coisas:
-- alguém iniciar um fluxo à mão, ou a própria função reagendar a rodada
-- seguinte com setTimeout. Só que a Supabase encerra o isolate assim que a
-- resposta é devolvida, e o timer morre junto (as outras functions do projeto
-- usam EdgeRuntime.waitUntil justamente por isso).
--
-- Na prática: um passo agendado para daqui a 5 minutos ficava parado até que
-- OUTRA coisa acordasse o processador — uma mensagem recebida, um fluxo
-- iniciado. Era o atraso no envio.
--
-- A cada minuto é o intervalo dos outros crons do projeto e é suficiente: a
-- menor espera que um fluxo consegue configurar é maior que isso, e a função
-- sai imediatamente quando não há nada pronto.

SELECT cron.unschedule('flow-processor-heartbeat')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'flow-processor-heartbeat');

SELECT cron.schedule(
  'flow-processor-heartbeat',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://nnjwemmerumzkiiykpas.supabase.co/functions/v1/flow-processor',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJIUzI1NiIsInJlZiI6Im5uandlbW1lcnVtemtpaXlrcGFzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1NDEwNDcsImV4cCI6MjA4NzExNzA0N30._GKCqMhMBR3j0jK438raMweCb2Bf_LMs-BuCwAPLQ48"}'::jsonb,
    body := '{"cron":true}'::jsonb
  );
  $$
);
