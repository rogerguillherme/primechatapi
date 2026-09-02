-- De qual plataforma este webhook recebe.
--
-- A taxa é configurada por plataforma ("Applyfy Pix 3% + R$ 2,49"), mas a venda
-- só sabe de onde veio se quem a criou disser. O endpoint é quem sabe: é ele
-- que foi colado no painel da Applyfy.
ALTER TABLE public.webhook_endpoints
  ADD COLUMN IF NOT EXISTS platform text;

COMMENT ON COLUMN public.webhook_endpoints.platform IS
  'Plataforma que envia para este endpoint (applyfy, kiwify, hotmart...). Copiada para orders.platform.';
