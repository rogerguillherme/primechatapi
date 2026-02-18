
-- Add account_id column to chat_messages to track which WhatsApp account sent/received the message
ALTER TABLE public.chat_messages ADD COLUMN account_id uuid REFERENCES public.whatsapp_accounts(id) ON DELETE SET NULL;

-- Create index for performance
CREATE INDEX idx_chat_messages_account_id ON public.chat_messages(account_id);
