ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS sent_by uuid;

COMMENT ON COLUMN public.chat_messages.sent_by IS
  'Usuário que enviou pelo chat. Nulo quando foi automação.';