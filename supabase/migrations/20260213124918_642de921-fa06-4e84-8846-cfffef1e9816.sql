-- Add delivery tracking columns to chat_messages
ALTER TABLE public.chat_messages 
  ADD COLUMN IF NOT EXISTS delivered_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS read_at timestamp with time zone;

-- Add index for metrics queries
CREATE INDEX IF NOT EXISTS idx_chat_messages_direction_status ON public.chat_messages(direction, status);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON public.chat_messages(created_at);
