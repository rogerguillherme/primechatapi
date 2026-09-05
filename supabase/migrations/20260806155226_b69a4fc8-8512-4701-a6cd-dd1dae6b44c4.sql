WITH q AS (
  SELECT id, row_number() OVER (ORDER BY started_at) AS rn
  FROM public.flow_executions
  WHERE flow_id = '900072cb-0ff8-45ae-a47b-f745beea8664'
    AND status = 'cancelled'
)
UPDATE public.flow_executions fe
SET status = 'waiting_delay',
    current_step_id = '11e33659-0043-486a-b554-5f180127bed0',
    next_action_at = now() + interval '3 minutes' + (q.rn * interval '60 seconds'),
    updated_at = now(),
    metadata = coalesce(fe.metadata, '{}'::jsonb) || jsonb_build_object('requeued_at', now(), 'requeue_reason', 'warmup_after_auto_pause')
FROM q
WHERE fe.id = q.id;

UPDATE public.flows
SET active = true, auto_paused_by_system = false, updated_at = now()
WHERE id = '900072cb-0ff8-45ae-a47b-f745beea8664';