CREATE INDEX IF NOT EXISTS idx_chat_messages_direction_created_at ON public.chat_messages (direction, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_id_user_id ON public.leads (id, user_id);