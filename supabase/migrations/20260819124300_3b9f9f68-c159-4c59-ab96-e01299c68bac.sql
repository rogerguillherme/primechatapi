with elig as (
  select l.id, row_number() over (order by l.last_inbound_at desc) rn
  from leads l
  where l.user_id='63ee595e-1023-4e4a-9290-5e3e9c1c98f6'
    and coalesce(l.unsubscribed,false)=false
    and l.last_inbound_at >= now() - interval '24 hours'
)
insert into flow_executions (flow_id, lead_id, current_step_id, status, next_action_at, metadata)
select '1a4b12e8-c99a-4682-9ab8-5dc99ce7627b', e.id, 'a1b2c3d4-0005-4000-8000-000000000005',
       'waiting_delay', now() + ((e.rn - 1) * interval '0.35 seconds'),
       jsonb_build_object('source','manual_copy_inscricoes_abertas')
from elig e;