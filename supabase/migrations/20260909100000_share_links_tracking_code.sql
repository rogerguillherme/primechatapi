-- Rastreio por código curto nos links de compartilhamento (Passo 1).
-- Estende share_links com canal/UTM/tracking_code, adiciona o log de matches
-- (share_link_matches) e dá a lead_attribution os campos de origem do link —
-- em paralelo ao ctwa_clid (Meta Ads) já existente. Um lead pode ter os dois
-- gravados; ctwa_clid é sinal mais forte por vir estruturado da própria Meta,
-- o texto do link pode ser copiado por qualquer um (ver comentário abaixo).

ALTER TABLE public.share_links
  ADD COLUMN IF NOT EXISTS channel text,
  ADD COLUMN IF NOT EXISTS utm_source text,
  ADD COLUMN IF NOT EXISTS utm_medium text,
  ADD COLUMN IF NOT EXISTS utm_campaign text,
  ADD COLUMN IF NOT EXISTS tracking_code text;

COMMENT ON COLUMN public.share_links.channel IS
  'Canal de origem do link — texto livre, sem enum de banco. Valores em uso: instagram_bio, instagram_story, instagram_post, tiktok_bio, qr_code, other.';
COMMENT ON COLUMN public.share_links.tracking_code IS
  'Código curto Crockford Base32 (5 chars, sem I/L/O/U) embutido na frase pré-preenchida, ex: "...#4K7XQ". Único por dono (ver constraint abaixo), não globalmente.';

-- Único por dono, não global: cada conta pode ter seus próprios códigos sem
-- colidir com os de outra. NULL não conflita com NULL (vários links sem
-- código convivem na mesma conta).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'share_links_user_tracking_code_key'
  ) THEN
    ALTER TABLE public.share_links
      ADD CONSTRAINT share_links_user_tracking_code_key UNIQUE (user_id, tracking_code);
  END IF;
END $$;

-- Log de cada match (por código ou por frase legada) — auditoria e debug de
-- atribuição, mesmo papel que attribution_events tem pro CAPI.
CREATE TABLE IF NOT EXISTS public.share_link_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  share_link_id uuid REFERENCES public.share_links(id),
  lead_id uuid NOT NULL,
  message_id text,
  matched_code text,
  matched_by text NOT NULL CHECK (matched_by IN ('code', 'phrase')),
  is_first_message boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_share_link_matches_owner ON public.share_link_matches(owner_id);
CREATE INDEX IF NOT EXISTS idx_share_link_matches_lead ON public.share_link_matches(lead_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.share_link_matches TO authenticated;
GRANT ALL ON public.share_link_matches TO service_role;

ALTER TABLE public.share_link_matches ENABLE ROW LEVEL SECURITY;

-- Mesmo padrão de attribution_events/lead_attribution: gravado pelo webhook
-- via service_role (bypassa RLS); usuário autenticado só lê o que é dele.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'share_link_matches'
      AND policyname = 'Owner views share link matches'
  ) THEN
    CREATE POLICY "Owner views share link matches"
      ON public.share_link_matches FOR SELECT TO authenticated
      USING (owner_id = auth.uid());
  END IF;
END $$;

ALTER TABLE public.lead_attribution
  ADD COLUMN IF NOT EXISTS share_link_id uuid REFERENCES public.share_links(id),
  ADD COLUMN IF NOT EXISTS channel text,
  ADD COLUMN IF NOT EXISTS utm_source text,
  ADD COLUMN IF NOT EXISTS utm_medium text,
  ADD COLUMN IF NOT EXISTS utm_campaign text;

COMMENT ON COLUMN public.lead_attribution.ctwa_clid IS
  'Sinal mais forte de origem: estruturado, entregue pela própria Meta. share_link_id/channel/utm_* (texto que o lead colou) são um sinal mais fraco — qualquer um pode copiar a frase de outra pessoa. Um lead pode ter os dois gravados; não há precedência de escrita, só de confiança na leitura.';
