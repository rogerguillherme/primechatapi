with t as (
  select id, row_number() over (order by next_action_at) rn
  from flow_executions
  where flow_id='1a4b12e8-c99a-4682-9ab8-5dc99ce7627b'
    and status in ('waiting_delay','running')
)
update flow_executions fe
set current_step_id='e5ac8449-e21d-4bb8-9242-0f893d5dfe8a',
    status='waiting_delay',
    next_action_at = now() + ((t.rn-1) * interval '0.35 seconds'),
    metadata = coalesce(fe.metadata,'{}'::jsonb) - 'send_attempts',
    updated_at = now()
from t where t.id = fe.id;