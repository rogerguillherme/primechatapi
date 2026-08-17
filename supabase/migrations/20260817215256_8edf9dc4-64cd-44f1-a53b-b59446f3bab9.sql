insert into public.chat_messages (lead_id, direction, content, status, account_id, created_at)
select fe.lead_id, 'inbound', 'Ativar notificações', 'received', 'f9587814-e978-449a-beba-f0f7915eaacd', now()
from public.flow_executions fe where fe.id = '2ae08908-225b-47ae-890f-2e6f4d2db5d5';

update public.flow_executions
set status = 'waiting_delay', next_action_at = now(), updated_at = now(),
    metadata = coalesce(metadata,'{}'::jsonb) - 'send_attempts'
where id = '2ae08908-225b-47ae-890f-2e6f4d2db5d5';