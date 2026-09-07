-- Atribuição CAPI nativa (Fase 1 — só WhatsApp / ctwa_clid). Roda em paralelo
-- à integração com a Metrito (metrito_settings), sem substituí-la ainda.

-- Credenciais do Meta CAPI por conta, com fallback pros secrets globais
-- (META_PIXEL_ID / META_CAPI_TOKEN) — mesmo padrão de metrito_settings.
-- Sem política de leitura para a equipe: guarda credencial, colaborador não
-- precisa enxergar o token do dono.
CREATE TABLE public.capi_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL UNIQUE,
  pixel_id text,
  access_token text,
  test_event_code text,           -- usado só na fase de validação (Test Events)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.capi_settings TO authenticated;
GRANT ALL ON public.capi_settings TO service_role;

ALTER TABLE public.capi_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner manages capi settings"
  ON public.capi_settings FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE TRIGGER update_capi_settings_updated_at
  BEFORE UPDATE ON public.capi_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- O ctwa_clid (Click-to-WhatsApp) só chega na 1ª mensagem do lead — guarda
-- ligado ao lead, 1:1. Não precisa da tabela de "sessão" do modelo completo
-- (essa só é necessária quando existe visita ao SITE antes do telefone
-- aparecer — fora do escopo desta fase).
CREATE TABLE public.lead_attribution (
  lead_id uuid PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  ctwa_clid text,
  phone_hash text NOT NULL,        -- SHA-256 do telefone normalizado
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_lead_attribution_owner ON public.lead_attribution(owner_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_attribution TO authenticated;
GRANT ALL ON public.lead_attribution TO service_role;

ALTER TABLE public.lead_attribution ENABLE ROW LEVEL SECURITY;

-- ponytail: leitura simplificada para o dono da conta (mesmo padrão de
-- metrito_settings). Nenhuma tela lê esta tabela ainda — se um dia uma UI
-- precisar mostrar isso pra equipe (não só o dono), trocar por
-- team_lead_scope()/team_access_level(), como leads.* já faz.
CREATE POLICY "Owner views lead attribution"
  ON public.lead_attribution FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

-- Log de eventos enviados ao Meta — dedup local + auditoria (capi_response).
CREATE TABLE public.attribution_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nulo é válido: um pedido da Hubla sem lead casado (ex.: refund avulso)
  -- ainda pode reportar evento usando as credenciais globais, igual ao
  -- comportamento existente de resolveMetritoCreds(supabase, null).
  owner_id uuid,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  event_name text NOT NULL,                       -- 'Lead' | 'Purchase'
  event_id text NOT NULL,                         -- dedup determinístico
  action_source text NOT NULL DEFAULT 'business_messaging',
  value numeric,
  currency text DEFAULT 'BRL',
  sent_to_capi boolean NOT NULL DEFAULT false,
  capi_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_attribution_events_dedup ON public.attribution_events(owner_id, event_id, event_name);
CREATE INDEX idx_attribution_events_lead ON public.attribution_events(lead_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.attribution_events TO authenticated;
GRANT ALL ON public.attribution_events TO service_role;

ALTER TABLE public.attribution_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner views attribution events"
  ON public.attribution_events FOR SELECT TO authenticated
  USING (owner_id = auth.uid());
