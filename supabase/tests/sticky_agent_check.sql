-- Check da regra de stickiness (distribute_lead + last_assigned_to).
-- Roda em qualquer Postgres vazio, sem framework:
--
--   psql -U postgres -h localhost -d postgres -v ON_ERROR_STOP=1 \
--        -f supabase/tests/sticky_agent_check.sql
--
-- Monta um esqueleto mínimo das tabelas, carrega a MIGRATION DE VERDADE
-- (nada de reimplementar a lógica aqui) e desfaz tudo no rollback final.
--
-- ATENÇÃO: aponte para um Postgres descartável. O script recria o schema
-- `public` do banco em que roda (tudo dentro da transação que sofre ROLLBACK,
-- mas não há motivo para rodar isso contra produção).

\set ON_ERROR_STOP on
BEGIN;

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;

-- Roles que a migration referencia nos GRANT/REVOKE.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;

CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  assigned_to uuid,
  stage_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.lead_distribution_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT false,
  trigger_mode text NOT NULL DEFAULT 'first_inbound',
  waiting_stage_id uuid,
  in_service_stage_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.lead_distribution_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  member_user_id uuid NOT NULL,
  weight_percent numeric NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  assigned_count integer NOT NULL DEFAULT 0,
  last_assigned_at timestamptz,
  UNIQUE (owner_id, member_user_id)
);

-- A migration sob teste.
\ir ../migrations/20260826120100_sticky_agent.sql

-- ── Fixture ──────────────────────────────────────────────────────────────────
\set owner '''11111111-1111-1111-1111-111111111111'''
\set ana   '''22222222-2222-2222-2222-222222222222'''
\set bruno '''33333333-3333-3333-3333-333333333333'''

INSERT INTO public.lead_distribution_settings (owner_id, enabled, sticky_agent)
  VALUES (:owner, true, false);
INSERT INTO public.lead_distribution_targets (owner_id, member_user_id, weight_percent, active, assigned_count)
  VALUES (:owner, :ana, 50, true, 0),
         (:owner, :bruno, 50, true, 0);

DO $$
DECLARE
  v_owner uuid := '11111111-1111-1111-1111-111111111111';
  v_ana   uuid := '22222222-2222-2222-2222-222222222222';
  v_bruno uuid := '33333333-3333-3333-3333-333333333333';
  v_lead  uuid;
  v_got   uuid;
  v_count integer;
  v_after integer;
BEGIN
  -- 1. Trigger lembra o responsável e PRESERVA ao desatribuir.
  INSERT INTO public.leads (user_id, assigned_to) VALUES (v_owner, v_ana) RETURNING id INTO v_lead;
  SELECT last_assigned_to INTO v_got FROM public.leads WHERE id = v_lead;
  ASSERT v_got = v_ana, 'insert com assigned_to deveria gravar last_assigned_to';

  UPDATE public.leads SET assigned_to = NULL WHERE id = v_lead;
  SELECT last_assigned_to INTO v_got FROM public.leads WHERE id = v_lead;
  ASSERT v_got = v_ana, 'desatribuir NÃO pode apagar last_assigned_to';

  -- 2. sticky OFF: volta para o rodízio, ignorando o histórico.
  --    Ana está com assigned_count alto, então o rodízio tem de escolher Bruno.
  UPDATE public.lead_distribution_targets SET assigned_count = 10 WHERE member_user_id = v_ana;
  v_got := public.distribute_lead(v_lead);
  ASSERT v_got = v_bruno, format('sticky OFF deveria rodiziar para Bruno, veio %s', v_got);

  -- 3. sticky ON + último responsável ATIVO: volta para ele.
  UPDATE public.lead_distribution_settings SET sticky_agent = true WHERE owner_id = v_owner;
  UPDATE public.leads SET assigned_to = NULL WHERE id = v_lead;
  UPDATE public.leads SET last_assigned_to = v_ana WHERE id = v_lead;
  SELECT assigned_count INTO v_count FROM public.lead_distribution_targets WHERE member_user_id = v_ana;

  v_got := public.distribute_lead(v_lead);
  ASSERT v_got = v_ana, format('sticky ON deveria devolver para Ana, veio %s', v_got);

  -- 4. Retorno não infla o contador do rateio.
  SELECT assigned_count INTO v_after FROM public.lead_distribution_targets WHERE member_user_id = v_ana;
  ASSERT v_after = v_count,
    format('retorno não pode mexer em assigned_count (era %s, virou %s)', v_count, v_after);

  -- 5. sticky ON + último responsável INATIVO: cai no rodízio.
  UPDATE public.lead_distribution_targets SET active = false WHERE member_user_id = v_ana;
  UPDATE public.leads SET assigned_to = NULL WHERE id = v_lead;
  v_got := public.distribute_lead(v_lead);
  ASSERT v_got = v_bruno, format('vendedor inativo não pode segurar o lead, veio %s', v_got);
  UPDATE public.lead_distribution_targets SET active = true, assigned_count = 10 WHERE member_user_id = v_ana;

  -- 6. sticky ON sem histórico: rodízio normal.
  INSERT INTO public.leads (user_id) VALUES (v_owner) RETURNING id INTO v_lead;
  SELECT last_assigned_to INTO v_got FROM public.leads WHERE id = v_lead;
  ASSERT v_got IS NULL, 'lead novo não deveria ter histórico';
  v_got := public.distribute_lead(v_lead);
  ASSERT v_got IS NOT NULL, 'lead sem histórico deveria ser distribuído pelo rodízio';

  -- 7. Lead que JÁ tem dono continua intocado.
  UPDATE public.leads SET assigned_to = v_bruno WHERE id = v_lead;
  v_got := public.distribute_lead(v_lead);
  ASSERT v_got IS NULL, 'lead com dono não pode ser redistribuído';

  RAISE NOTICE 'sticky_agent_check: OK (7 casos)';
END $$;

ROLLBACK;
