UPDATE public.flow_executions 
SET current_step_id = '484ecdd3-3821-4238-a077-5dafd229e568',
    status = 'waiting_delay',
    next_action_at = now()
WHERE id = 'd6cfdbf8-a0b4-4cc1-ad0f-a8d57ceb0101';