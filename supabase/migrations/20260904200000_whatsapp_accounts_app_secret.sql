-- App Secret por conta: até aqui a verificação de assinatura da Meta
-- (X-Hub-Signature-256) tentava uma lista global de secrets
-- (META_APP_SECRET/META_APP_SECRETS) e, se nenhum batesse, aceitava o
-- payload SEM assinatura contanto que o phone_number_id estivesse
-- cadastrado — brecha necessária enquanto várias contas dividiam o mesmo app
-- Meta. Com app isolado por conta (decisão operacional), cada conta pode
-- guardar o PRÓPRIO App Secret e ser verificada contra ele, fechando esse
-- fallback pra quem já migrou.
ALTER TABLE public.whatsapp_accounts
  ADD COLUMN IF NOT EXISTS app_secret text;

COMMENT ON COLUMN public.whatsapp_accounts.app_secret IS
  'App Secret do app Meta usado só por esta conta. Quando preenchido, a assinatura do webhook é verificada só contra ele (a lista global META_APP_SECRETS deixa de valer pra essa conta).';
