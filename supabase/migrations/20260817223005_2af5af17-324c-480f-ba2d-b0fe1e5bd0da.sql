with x as (
  select e.id, row_number() over (partition by l.phone order by e.started_at) rn
  from flow_executions e
  join leads l on l.id = e.lead_id
  where e.flow_id = '58789d4f-1014-4bfe-b108-47fc97473a1c'
    and e.status in ('waiting_delay','running')
)
update flow_executions fe
set status = 'cancelled', next_action_at = null, updated_at = now(),
    metadata = coalesce(fe.metadata,'{}'::jsonb) || jsonb_build_object('cancel_reason','duplicate_phone_same_campaign')
from x
where fe.id = x.id and x.rn > 1;