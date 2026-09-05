update public.flow_executions
set current_step_id = 'a6a4a799-e692-4ce1-99f1-27ea3390024e',
    status = 'waiting_delay',
    next_action_at = now(),
    updated_at = now()
where id = '2ae08908-225b-47ae-890f-2e6f4d2db5d5' and status = 'waiting_reply';