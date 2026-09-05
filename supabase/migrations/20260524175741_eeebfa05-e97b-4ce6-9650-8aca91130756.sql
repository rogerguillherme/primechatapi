UPDATE flow_executions
SET 
  current_step_id = 'aafbaf2a-8427-4604-b567-611a6fa37ccd',
  status = 'waiting_delay',
  next_action_at = now() + (random() * interval '300 seconds'),
  metadata = jsonb_set(
    COALESCE(metadata, '{}'::jsonb) - 'send_attempts',
    '{account_id}',
    '"6a1b1691-6cbc-4311-a6d5-0669f98cc643"'
  ),
  updated_at = now()
WHERE status = 'waiting_reply'
  AND flow_id = '946f3532-5aec-443b-acbf-62e8a43bd4de'
  AND started_at >= '2026-05-24 17:30:00'
  AND current_step_id = 'c728d784-c56c-41ba-8629-855994b9b89c';