-- Conta travada pela Meta.
--
-- 131031 ("Business account has been locked") não é banimento do número: é a
-- conta comercial travada. O envio para de sair, o recebimento continua — e o
-- app não sabia da diferença. Fluxo, disparo e atendente seguiam mandando, cada
-- mensagem falhando sozinha, sem nada dizendo que a causa era a mesma para
-- todas. Isso empilha falha de entrega, que é justamente o que a Meta mede.
ALTER TABLE public.whatsapp_accounts
  ADD COLUMN IF NOT EXISTS blocked_at timestamptz,
  ADD COLUMN IF NOT EXISTS blocked_reason text;

COMMENT ON COLUMN public.whatsapp_accounts.blocked_at IS
  'Quando a Meta recusou envio por bloqueio da conta (131031/368/131042). Nulo = liberada.';
COMMENT ON COLUMN public.whatsapp_accounts.blocked_reason IS
  'Texto da Meta que acompanhou o bloqueio, para o recurso.';
