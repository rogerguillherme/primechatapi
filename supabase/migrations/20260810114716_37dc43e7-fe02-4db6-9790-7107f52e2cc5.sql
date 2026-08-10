ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS error_title text,
  ADD COLUMN IF NOT EXISTS error_details text;

CREATE INDEX IF NOT EXISTS idx_chat_messages_error_code
  ON public.chat_messages (error_code)
  WHERE error_code IS NOT NULL;