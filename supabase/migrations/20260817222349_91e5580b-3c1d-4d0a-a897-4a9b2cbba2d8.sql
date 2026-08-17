-- 1) Cancel ancient stuck executions (claimed as running for over 24h)
UPDATE public.flow_executions
SET status = 'cancelled',
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('cancel_reason', 'stale_running_cleanup'),
    updated_at = now()
WHERE status = 'running'
  AND updated_at < now() - interval '24 hours';

-- 2) Requeue recent stuck executions so the processor picks them up again
UPDATE public.flow_executions
SET status = 'waiting_delay',
    next_action_at = now(),
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('send_attempts', 0, 'recovered_at', now()),
    updated_at = now()
WHERE status = 'running'
  AND updated_at < now() - interval '10 minutes';

-- 3) Watchdog: auto-recover executions stuck in "running"
CREATE OR REPLACE FUNCTION public.recover_stuck_flow_executions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recovered integer := 0;
BEGIN
  UPDATE public.flow_executions
  SET status = 'cancelled',
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('cancel_reason', 'stale_running_cleanup'),
      updated_at = now()
  WHERE status = 'running'
    AND updated_at < now() - interval '24 hours';

  UPDATE public.flow_executions
  SET status = 'waiting_delay',
      next_action_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('send_attempts', 0, 'recovered_at', now()),
      updated_at = now()
  WHERE status = 'running'
    AND updated_at < now() - interval '10 minutes';

  GET DIAGNOSTICS recovered = ROW_COUNT;
  RETURN recovered;
END;
$$;

REVOKE ALL ON FUNCTION public.recover_stuck_flow_executions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recover_stuck_flow_executions() TO service_role;

SELECT cron.unschedule('recover-stuck-flow-executions')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'recover-stuck-flow-executions');

SELECT cron.schedule(
  'recover-stuck-flow-executions',
  '*/5 * * * *',
  $$SELECT public.recover_stuck_flow_executions();$$
);