alter table public.chat_messages drop constraint if exists chat_messages_status_check;

alter table public.chat_messages
  add constraint chat_messages_status_check
  check (status = any (array['sent'::text, 'delivered'::text, 'read'::text, 'failed'::text, 'received'::text, 'accepted'::text, 'queued'::text, 'processing'::text]));