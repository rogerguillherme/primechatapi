UPDATE public.flow_executions
SET status = 'waiting_delay', updated_at = now()
WHERE status = 'running'
AND updated_at < now() - interval '5 minutes';