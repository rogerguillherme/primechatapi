-- Prime Group (Instâncias): status de conexão e foto de perfil, persistidos
-- na própria conexão em vez de calculados a cada request — a tela de
-- Instâncias lista várias contas de uma vez e não pode chamar a Evolution
-- uma vez por card só pra montar a lista.
ALTER TABLE public.whatsapp_accounts
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS profile_picture text;

COMMENT ON COLUMN public.whatsapp_accounts.status IS
  'Último estado de conexão conhecido (online/connecting/offline) — atualizado pela action "status" da evolution-instance. Null para contas nunca checadas ou provider != evolution.';
