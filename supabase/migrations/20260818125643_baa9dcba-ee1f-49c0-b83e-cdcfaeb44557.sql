with acc as (select 'b2ca636b-8c85-4ef9-82a6-c5ed82f43775'::uuid id),
entry as (select id from flow_steps where flow_id='0a665c60-fec6-42ad-ae9b-66cc4510b1b9' and is_entry limit 1),
err as (
  select distinct fe.id as exec_id
  from flow_executions fe
  join chat_messages cm on cm.lead_id = fe.lead_id
  where fe.flow_id='0a665c60-fec6-42ad-ae9b-66cc4510b1b9'
    and cm.direction='outbound' and cm.created_at > '2026-08-18 11:50:00+00'
    and cm.status='failed' and cm.error_code::text = '131026'
    and not exists (
      select 1 from chat_messages ok
      where ok.lead_id = fe.lead_id and ok.direction='outbound'
        and ok.created_at > '2026-08-18 11:50:00+00'
        and ok.status in ('delivered','read','sent')
    )
),
pend as (
  select l.id as lead_id
  from leads l
  where l.user_id='63ee595e-1023-4e4a-9290-5e3e9c1c98f6'
    and l.origin='csv_import'
    and l.created_at > '2026-08-17 20:00+00'
    and coalesce(l.unsubscribed,false) = false
    and not exists (select 1 from flow_executions fe where fe.lead_id = l.id)
    and not exists (select 1 from chat_messages cm where cm.lead_id = l.id and cm.direction='outbound')
),
ins as (
  insert into flow_executions (flow_id, lead_id, current_step_id, status, next_action_at, started_at, updated_at, metadata)
  select '0a665c60-fec6-42ad-ae9b-66cc4510b1b9', p.lead_id, (select id from entry), 'waiting_delay',
         now() + interval '2 minutes' + ((row_number() over (order by p.lead_id)) * interval '90 seconds'),
         now(), now(),
         jsonb_build_object('account_id', (select id from acc)::text, 'requeued_at', now(), 'requeue_reason', 'restante_bm2')
  from pend p
  returning 1
),
upd as (
  update flow_executions fe
  set status='waiting_delay',
      current_step_id=(select id from entry),
      next_action_at = now() + interval '2 minutes'
        + ((select count(*) from pend) * interval '90 seconds')
        + (r.rn * interval '120 seconds'),
      updated_at = now(),
      metadata = coalesce(fe.metadata,'{}'::jsonb)
        || jsonb_build_object('account_id', (select id from acc)::text, 'send_attempts', 0,
                              'requeued_at', now(), 'requeue_reason', 'retry_131026_6614')
  from (select exec_id, row_number() over (order by exec_id) rn from err) r
  where fe.id = r.exec_id
  returning 1
)
select (select count(*) from ins) as novos, (select count(*) from upd) as reenfileirados_erro;