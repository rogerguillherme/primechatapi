-- Quem enviou a mensagem.
--
-- O histórico não guardava autor: depois de transferir o contato para outra
-- vendedora, não havia como saber quem tinha falado o quê. Numa conta com
-- equipe, isso é metade do valor de reler a conversa.
--
-- Nulo = enviada pelo sistema (fluxo, disparo, agente de IA), que é o caso da
-- maior parte das mensagens antigas.
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS sent_by uuid;

COMMENT ON COLUMN public.chat_messages.sent_by IS
  'Usuário que enviou pelo chat. Nulo quando foi automação.';
