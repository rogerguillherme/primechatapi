-- Prime Metrics — elos, metas e temporada.
--
-- Venda, vendedor e multiempresa já existem: `orders` guarda a venda, o
-- vendedor sai de `leads.assigned_to` (quem atende o lead é quem fecha), e o
-- isolamento entre clientes vem de team_access_level, como no resto do app.
-- Só faltava o que o plano chama de motor de gamificação: o corte de cada elo,
-- a meta do período e a temporada.
--
-- Nada aqui duplica dado de venda. Faturamento, comissão e progresso são
-- CALCULADOS a partir de orders na hora da leitura — número de venda gravado
-- em dois lugares é número que diverge.

-- ── Elos ──
-- Configuráveis por empresa desde o início: o plano aponta que no sistema
-- avaliado a faixa de comissão parecia fixa, sem o admin poder mexer.
CREATE TABLE IF NOT EXISTS public.metrics_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  name text NOT NULL,
  min_value numeric(12,2) NOT NULL DEFAULT 0,
  commission_pct numeric(5,2) NOT NULL DEFAULT 0,
  color text NOT NULL DEFAULT '#64748b',
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.metrics_tiers.min_value IS
  'Faturamento acumulado no período a partir do qual o vendedor entra neste elo.';
COMMENT ON COLUMN public.metrics_tiers.commission_pct IS
  'Percentual de comissão deste elo. Parametrizável por empresa.';

CREATE INDEX IF NOT EXISTS idx_metrics_tiers_owner
  ON public.metrics_tiers (owner_id, min_value);

-- ── Metas ──
CREATE TABLE IF NOT EXISTS public.metrics_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  -- 'coletiva' = a empresa inteira; 'individual' = um vendedor.
  scope text NOT NULL DEFAULT 'coletiva',
  member_user_id uuid,
  period_start date NOT NULL,
  period_end date NOT NULL,
  target_value numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT metrics_goals_scope_check CHECK (scope IN ('coletiva', 'individual')),
  -- Meta individual sem vendedor não quer dizer nada.
  CONSTRAINT metrics_goals_member_check
    CHECK (scope = 'coletiva' OR member_user_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_metrics_goals_owner_period
  ON public.metrics_goals (owner_id, period_start, period_end);

-- ── Temporada ──
-- Só o rótulo do período; o recorte de datas vem das metas.
CREATE TABLE IF NOT EXISTS public.metrics_seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  name text NOT NULL,
  starts_at date NOT NULL,
  ends_at date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_metrics_seasons_owner
  ON public.metrics_seasons (owner_id, starts_at DESC);

-- ── Acesso ──
-- Mesma regra do resto do app: quem enxerga a empresa lê; quem manda nela
-- escreve. O vendedor comum vê o ranking (é o ponto da gamificação) mas não
-- muda o próprio corte de elo.
ALTER TABLE public.metrics_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metrics_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metrics_seasons ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['metrics_tiers', 'metrics_goals', 'metrics_seasons'] LOOP
    EXECUTE format($f$
      DROP POLICY IF EXISTS "team reads %1$s" ON public.%1$I;
      CREATE POLICY "team reads %1$s" ON public.%1$I
        FOR SELECT TO authenticated
        USING (public.team_access_level(owner_id) IS NOT NULL);

      DROP POLICY IF EXISTS "managers insert %1$s" ON public.%1$I;
      CREATE POLICY "managers insert %1$s" ON public.%1$I
        FOR INSERT TO authenticated
        WITH CHECK (public.team_access_level(owner_id) IN ('owner','manager'));

      DROP POLICY IF EXISTS "managers update %1$s" ON public.%1$I;
      CREATE POLICY "managers update %1$s" ON public.%1$I
        FOR UPDATE TO authenticated
        USING (public.team_access_level(owner_id) IN ('owner','manager'));

      DROP POLICY IF EXISTS "managers delete %1$s" ON public.%1$I;
      CREATE POLICY "managers delete %1$s" ON public.%1$I
        FOR DELETE TO authenticated
        USING (public.team_access_level(owner_id) IN ('owner','manager'));
    $f$, t);
  END LOOP;
END $$;
