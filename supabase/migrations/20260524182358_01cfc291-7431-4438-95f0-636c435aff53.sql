UPDATE public.flow_executions
SET status = 'cancelled',
    next_action_at = NULL,
    updated_at = now(),
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('paused_by_user', true, 'paused_at', now())
WHERE metadata->>'resumed_from_error' = 'true'
  AND status IN ('waiting_delay', 'waiting_reply', 'running');