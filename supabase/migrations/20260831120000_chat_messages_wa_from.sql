-- O endereço que a Meta usa para rotear, guardado na mensagem que chegou.
--
-- O telefone do lead pode estar na variante errada do nono dígito: a conversa
-- entra normalmente e toda resposta falha depois com 131026. O webhook já
-- corrige o lead quando ele escreve, mas isso não alcança quem não escreveu
-- mais — e não havia de onde deduzir o número certo, porque o wa_id não ficava
-- em lugar nenhum. Guardá-lo aqui torna esse conserto possível depois.
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS wa_from text;

COMMENT ON COLUMN public.chat_messages.wa_from IS
  'wa_id do remetente na mensagem recebida, normalizado com DDI (o endereço que a Meta roteia). Só em mensagens de entrada.';

-- Só as de entrada preenchem a coluna, e a busca é sempre por lead.
CREATE INDEX IF NOT EXISTS idx_chat_messages_wa_from
  ON public.chat_messages (lead_id, wa_from)
  WHERE wa_from IS NOT NULL;
