update public.leads set unsubscribed=false, unsubscribed_at=null, unsubscribe_reason=null where id='bcc781ae-66af-46df-9c7b-6260db67d82e';
delete from public.lead_blacklist where lead_id='bcc781ae-66af-46df-9c7b-6260db67d82e' and reason='unsubscribe_keyword';
delete from public.unsubscribe_logs where lead_id='bcc781ae-66af-46df-9c7b-6260db67d82e';