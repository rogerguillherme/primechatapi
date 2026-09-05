ALTER TABLE public.whatsapp_accounts
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'meta_cloud',
  ADD COLUMN IF NOT EXISTS api_key text;

COMMENT ON COLUMN public.whatsapp_accounts.provider IS 'Provedor da API: meta_cloud (padrão) ou d360 (360dialog Messenger)';
COMMENT ON COLUMN public.whatsapp_accounts.api_key IS 'D360-API-KEY usada quando provider=d360. Para meta_cloud é null.';