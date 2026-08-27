-- `recover_stuck_flow_executions` é rotina interna (chamada pelo agendador via
-- service_role). Estava executável por anon/authenticated: qualquer visitante
-- poderia reprocessar execuções de fluxo de qualquer conta.
REVOKE ALL ON FUNCTION public.recover_stuck_flow_executions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recover_stuck_flow_executions() TO service_role;