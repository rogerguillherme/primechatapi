-- ============================================================================
-- Prime Group — clone isolado do Group Flow DENTRO do Prime Chat.
--
-- Objetivo: trazer o sistema de campanhas/grupos/leads do Group Flow (produto
-- separado, conta MenopausaC) pra dentro do Prime Chat como um módulo próprio,
-- SEM depender do banco nem do deploy do Group Flow de hoje.
--
-- Isolamento: todas as tabelas novas usam o prefixo `pg_` (prime group). Elas
-- NÃO tocam nas tabelas do Prime Chat (broadcast_jobs, leads, campaign_events)
-- nem nas do Group Flow. Reaproveitam apenas o que o Prime Group já modela:
--   - Instância  = whatsapp_accounts (provider = 'evolution')
--   - Grupo      = whatsapp_groups
--
-- Envio de fato (motor Evolution) fica pra fase final — aqui montamos toda a
-- camada de dados + UI. As campanhas nascem em 'rascunho'/'agendada'.
-- ============================================================================

-- ------------------------------------------------------------------ campaigns
-- Uma campanha = um disparo pra um conjunto de grupos, a partir de UMA
-- instância, com intervalo anti-ban entre envios.
CREATE TABLE IF NOT EXISTS public.pg_campaigns (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id    UUID REFERENCES public.whatsapp_accounts(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  message       TEXT NOT NULL DEFAULT '',
  media_url     TEXT,
  media_type    TEXT,                       -- image | video | document | audio | null
  status        TEXT NOT NULL DEFAULT 'rascunho',
                 -- rascunho | agendada | enviando | pausada | concluida | falhou
  scheduled_at  TIMESTAMPTZ,
  interval_min  INT NOT NULL DEFAULT 8,      -- segundos, anti-ban
  interval_max  INT NOT NULL DEFAULT 25,
  total_targets INT NOT NULL DEFAULT 0,
  sent_count    INT NOT NULL DEFAULT 0,
  error_count   INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pg_campaigns_user_idx    ON public.pg_campaigns(user_id);
CREATE INDEX IF NOT EXISTS pg_campaigns_status_idx  ON public.pg_campaigns(status);
CREATE INDEX IF NOT EXISTS pg_campaigns_account_idx ON public.pg_campaigns(account_id);

-- ------------------------------------------------------------ campaign_targets
-- Um alvo = um grupo dentro de uma campanha. Guarda o resultado por grupo.
CREATE TABLE IF NOT EXISTS public.pg_campaign_targets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  UUID NOT NULL REFERENCES public.pg_campaigns(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  group_id     UUID REFERENCES public.whatsapp_groups(id) ON DELETE SET NULL,
  group_jid    TEXT NOT NULL,
  group_name   TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pendente',  -- pendente | enviado | erro
  error        TEXT,
  sent_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pg_targets_campaign_idx ON public.pg_campaign_targets(campaign_id);
CREATE INDEX IF NOT EXISTS pg_targets_user_idx     ON public.pg_campaign_targets(user_id);

-- ----------------------------------------------------------------- activities
-- Feed de atividades do módulo (campanha criada, agendada, envio, erro, etc.).
CREATE TABLE IF NOT EXISTS public.pg_activities (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id  UUID REFERENCES public.pg_campaigns(id) ON DELETE SET NULL,
  type         TEXT NOT NULL,               -- campanha_criada | agendada | envio | erro | grupo_sync | lead_sync | info
  title        TEXT NOT NULL,
  detail       TEXT,
  metadata     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pg_activities_user_idx ON public.pg_activities(user_id, created_at DESC);

-- ----------------------------------------------------------------- group_leads
-- Leads = participantes extraídos dos grupos. Chave por (user, telefone, grupo)
-- pra o mesmo número em vários grupos não colidir, mas não duplicar no mesmo.
CREATE TABLE IF NOT EXISTS public.pg_group_leads (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id   UUID REFERENCES public.whatsapp_accounts(id) ON DELETE SET NULL,
  group_id     UUID REFERENCES public.whatsapp_groups(id) ON DELETE CASCADE,
  group_jid    TEXT NOT NULL,
  group_name   TEXT NOT NULL DEFAULT '',
  phone        TEXT NOT NULL,
  name         TEXT,
  is_admin     BOOLEAN NOT NULL DEFAULT false,
  added_at     TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, phone, group_jid)
);
CREATE INDEX IF NOT EXISTS pg_group_leads_user_idx  ON public.pg_group_leads(user_id);
CREATE INDEX IF NOT EXISTS pg_group_leads_group_idx ON public.pg_group_leads(group_id);
CREATE INDEX IF NOT EXISTS pg_group_leads_phone_idx ON public.pg_group_leads(phone);

-- ------------------------------------------------------------------- blacklist
-- Números que nunca devem receber disparo (opt-out / risco).
CREATE TABLE IF NOT EXISTS public.pg_blacklist (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone       TEXT NOT NULL,
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, phone)
);
CREATE INDEX IF NOT EXISTS pg_blacklist_user_idx ON public.pg_blacklist(user_id);

-- -------------------------------------------------------------------- settings
-- Configurações do módulo por usuário (padrões de intervalo, anti-ban, limite).
CREATE TABLE IF NOT EXISTS public.pg_settings (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  default_interval_min INT NOT NULL DEFAULT 8,
  default_interval_max INT NOT NULL DEFAULT 25,
  anti_ban             BOOLEAN NOT NULL DEFAULT true,
  daily_limit          INT NOT NULL DEFAULT 500,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- RLS — mesmo padrão de whatsapp_groups: dono + equipe leem; dono + gerente
-- escrevem. Isso mantém o módulo coerente com o resto do Prime Chat.
-- ============================================================================
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'pg_campaigns','pg_campaign_targets','pg_activities',
    'pg_group_leads','pg_blacklist','pg_settings'
  ]
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated;', tbl);
    EXECUTE format('GRANT ALL ON public.%I TO service_role;', tbl);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);

    EXECUTE format($f$
      CREATE POLICY "pg equipe le" ON public.%I
        FOR SELECT TO authenticated
        USING (auth.uid() = user_id OR public.team_access_level(user_id) IS NOT NULL);
    $f$, tbl);

    EXECUTE format($f$
      CREATE POLICY "pg dono gerente insere" ON public.%I
        FOR INSERT TO authenticated
        WITH CHECK (auth.uid() = user_id OR public.team_access_level(user_id) IN ('owner','manager'));
    $f$, tbl);

    EXECUTE format($f$
      CREATE POLICY "pg dono gerente atualiza" ON public.%I
        FOR UPDATE TO authenticated
        USING (auth.uid() = user_id OR public.team_access_level(user_id) IN ('owner','manager'))
        WITH CHECK (auth.uid() = user_id OR public.team_access_level(user_id) IN ('owner','manager'));
    $f$, tbl);

    EXECUTE format($f$
      CREATE POLICY "pg dono gerente remove" ON public.%I
        FOR DELETE TO authenticated
        USING (auth.uid() = user_id OR public.team_access_level(user_id) IN ('owner','manager'));
    $f$, tbl);
  END LOOP;
END $$;

-- updated_at automático onde faz sentido
CREATE TRIGGER pg_campaigns_updated_at BEFORE UPDATE ON public.pg_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER pg_settings_updated_at BEFORE UPDATE ON public.pg_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
