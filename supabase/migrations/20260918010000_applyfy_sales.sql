-- Vendas recebidas via webhook da ApplyFy, com as UTMs de trackProps já
-- separadas em colunas pra dar pra agrupar/filtrar sem parsear JSON toda hora.
--
-- webhook_token: gerado pela ApplyFy quando o webhook é criado no painel dela
-- (Configurações > Webhooks) — é o único jeito de saber DE QUAL conta é a
-- notificação, já que o endpoint é público (a ApplyFy chama sem JWT nosso).

ALTER TABLE public.applyfy_credentials
  ADD COLUMN IF NOT EXISTS webhook_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS applyfy_credentials_webhook_token_idx
  ON public.applyfy_credentials(webhook_token) WHERE webhook_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.applyfy_sales (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  transaction_id      TEXT NOT NULL,
  event               TEXT,
  status              TEXT NOT NULL DEFAULT 'PENDING',
  amount_cents        INTEGER NOT NULL DEFAULT 0,
  payment_method      TEXT,
  product_name        TEXT,
  product_external_id TEXT,
  client_name         TEXT,
  client_phone        TEXT,
  client_email        TEXT,
  utm_source          TEXT,
  utm_medium          TEXT,
  utm_campaign        TEXT,
  utm_content         TEXT,
  utm_term            TEXT,
  raw_payload         JSONB,
  payed_at            TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, transaction_id)
);
CREATE INDEX IF NOT EXISTS applyfy_sales_user_idx ON public.applyfy_sales(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS applyfy_sales_utm_idx ON public.applyfy_sales(user_id, utm_source, utm_medium);

GRANT SELECT ON public.applyfy_sales TO authenticated;
GRANT ALL ON public.applyfy_sales TO service_role;
ALTER TABLE public.applyfy_sales ENABLE ROW LEVEL SECURITY;

-- Só leitura pra equipe: quem grava é sempre o webhook, com service role.
CREATE POLICY "applyfy sales equipe le" ON public.applyfy_sales
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.team_access_level(user_id) IS NOT NULL);

CREATE TRIGGER applyfy_sales_updated_at BEFORE UPDATE ON public.applyfy_sales
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
