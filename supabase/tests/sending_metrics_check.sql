-- Check da aritmética das métricas de disparo separadas por origem.
-- Roda em qualquer Postgres vazio, sem framework:
--
--   psql -U postgres -h localhost -d postgres -v ON_ERROR_STOP=1 \
--        -f supabase/tests/sending_metrics_check.sql
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

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;

-- auth.uid() do Supabase, trocável por SET no teste.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;

CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid
);

CREATE TABLE public.flows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL
);

CREATE TABLE public.flow_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id uuid NOT NULL REFERENCES public.flows(id),
  lead_id uuid NOT NULL,
  status text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.broadcast_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  campaign_name text,
  template_name text,
  status text NOT NULL DEFAULT 'completed',
  total_leads integer NOT NULL DEFAULT 0,
  sent_count integer NOT NULL DEFAULT 0,
  delivered_count integer NOT NULL DEFAULT 0,
  read_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.message_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  user_id uuid NOT NULL,
  lead_id uuid,
  account_id uuid,
  phone text NOT NULL DEFAULT '',
  status text NOT NULL,
  wa_message_id text,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL,
  account_id uuid,
  direction text NOT NULL,
  content text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'sent',
  zapi_message_id text,
  error_code text,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- A migration sob teste.
\ir ../migrations/20260827150000_sending_metrics_by_source.sql

-- ── Fixture ──────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_me     uuid := '11111111-1111-1111-1111-111111111111';
  v_outro  uuid := '22222222-2222-2222-2222-222222222222';
  v_conta  uuid := '33333333-3333-3333-3333-333333333333';
  v_job    uuid;
  v_flow   uuid;
  v_lead   uuid;
  v_lead2  uuid;
  r        record;
  v_n      bigint;
BEGIN
  INSERT INTO public.leads (user_id) VALUES (v_me) RETURNING id INTO v_lead;
  INSERT INTO public.leads (user_id) VALUES (v_outro) RETURNING id INTO v_lead2;

  INSERT INTO public.broadcast_jobs (user_id, campaign_name, total_leads, delivered_count, read_count)
    VALUES (v_me, 'Campanha A', 3000, 9999, 0) RETURNING id INTO v_job;

  -- 2.500 mensagens de disparo: 1.500 lidas, 700 entregues não lidas,
  -- 200 enviadas sem confirmação, 100 com erro.
  -- É exatamente aqui que o código antigo quebrava: ele buscava as linhas e
  -- somava no navegador, e o PostgREST corta em 1.000 por requisição.
  INSERT INTO public.message_logs (job_id, user_id, lead_id, account_id, status, wa_message_id)
  SELECT v_job, v_me, v_lead, v_conta,
         CASE
           WHEN g <= 1500 THEN 'read'
           WHEN g <= 2200 THEN 'delivered'
           WHEN g <= 2400 THEN 'sent'
           ELSE 'failed'
         END,
         'wamid.' || g
  FROM generate_series(1, 2500) g;

  -- Ruído de outro dono: nunca pode aparecer.
  INSERT INTO public.message_logs (job_id, user_id, lead_id, status, wa_message_id)
    VALUES (v_job, v_outro, v_lead2, 'read', 'wamid.alheio');

  -- Fluxo: dois lotes no MESMO dia, separados por mais de 30 min.
  INSERT INTO public.flows (user_id, name) VALUES (v_me, 'Boas-vindas') RETURNING id INTO v_flow;
  INSERT INTO public.flow_executions (flow_id, lead_id, status, started_at)
  SELECT v_flow, v_lead,
         CASE WHEN g <= 40 THEN 'completed' WHEN g <= 45 THEN 'failed' ELSE 'waiting_delay' END,
         timestamptz '2026-08-20 09:00:00+00' + (g || ' seconds')::interval
  FROM generate_series(1, 50) g;
  INSERT INTO public.flow_executions (flow_id, lead_id, status, started_at)
  SELECT v_flow, v_lead, 'completed',
         timestamptz '2026-08-20 14:00:00+00' + (g || ' seconds')::interval
  FROM generate_series(1, 20) g;

  -- Chat: 30 mensagens do atendente/fluxo + 5 que vieram do disparo em massa
  -- (mesmo wa_message_id gravado em message_logs) e não podem contar duas vezes.
  INSERT INTO public.chat_messages (lead_id, account_id, direction, status, zapi_message_id, read_at)
  SELECT v_lead, v_conta, 'outbound',
         CASE WHEN g <= 12 THEN 'read' WHEN g <= 25 THEN 'delivered' ELSE 'sent' END,
         'chat.' || g,
         CASE WHEN g <= 12 THEN now() END
  FROM generate_series(1, 30) g;
  INSERT INTO public.chat_messages (lead_id, account_id, direction, status, zapi_message_id)
  SELECT v_lead, v_conta, 'outbound', 'sent', 'wamid.' || g
  FROM generate_series(1, 5) g;
  -- Inbound e mensagem de outro dono: fora da conta.
  INSERT INTO public.chat_messages (lead_id, direction, status) VALUES (v_lead, 'inbound', 'received');
  INSERT INTO public.chat_messages (lead_id, direction, status) VALUES (v_lead2, 'outbound', 'read');

  PERFORM set_config('test.uid', v_me::text, true);

  -- ── 1. Disparo em massa: nada de teto de 1.000 ────────────────────────────
  SELECT * INTO r FROM public.get_sending_metrics_by_source() WHERE source = 'broadcast';
  ASSERT r.sent = 2400, format('broadcast.sent deveria ser 2400, veio %s', r.sent);
  ASSERT r.delivered = 2200, format('broadcast.delivered deveria ser 2200, veio %s', r.delivered);
  ASSERT r.read = 1500, format('broadcast.read deveria ser 1500, veio %s', r.read);
  ASSERT r.failed = 100, format('broadcast.failed deveria ser 100, veio %s', r.failed);
  ASSERT r.account_id = v_conta, 'broadcast deveria vir agrupado pela conta';

  -- lido ⊆ entregue ⊆ enviado — as três NUNCA se somam
  ASSERT r.read <= r.delivered AND r.delivered <= r.sent, 'estados acumulativos violados';

  -- ── 2. Fluxos: contagem própria, sem entrega/leitura inventada ────────────
  SELECT * INTO r FROM public.get_sending_metrics_by_source() WHERE source = 'flow';
  ASSERT r.sent = 60, format('flow.sent deveria ser 60 (40 + 20), veio %s', r.sent);
  ASSERT r.failed = 5, format('flow.failed deveria ser 5, veio %s', r.failed);
  ASSERT r.pending = 5, format('flow.pending deveria ser 5, veio %s', r.pending);
  ASSERT r.delivered IS NULL, 'fluxo não sabe entrega — tem de vir NULL, não 0';
  ASSERT r.read IS NULL, 'fluxo não sabe leitura — tem de vir NULL, não 0';
  ASSERT r.tracks_delivery = false, 'fluxo deveria se declarar sem rastreio de entrega';

  -- ── 3. Chat exclui o disparo em massa (anti-join por wa_message_id) ───────
  SELECT * INTO r FROM public.get_sending_metrics_by_source() WHERE source = 'chat';
  ASSERT r.sent = 30, format('chat.sent deveria ser 30 (as 5 do disparo saem), veio %s', r.sent);
  ASSERT r.delivered = 25, format('chat.delivered deveria ser 25, veio %s', r.delivered);
  ASSERT r.read = 12, format('chat.read deveria ser 12, veio %s', r.read);

  -- ── 4. Isolamento por dono ────────────────────────────────────────────────
  PERFORM set_config('test.uid', v_outro::text, true);
  SELECT coalesce(sum(sent), 0) INTO v_n FROM public.get_sending_metrics_by_source() WHERE source = 'broadcast';
  ASSERT v_n = 1, format('outro dono deveria ver só a mensagem dele, veio %s', v_n);
  SELECT count(*) INTO v_n FROM public.get_sending_metrics_by_source() WHERE source = 'flow';
  ASSERT v_n = 0, 'outro dono não tem fluxo — não deveria vir linha nenhuma';
  PERFORM set_config('test.uid', v_me::text, true);

  -- ── 5. Progresso do disparo: fila = alvo - processadas ────────────────────
  SELECT * INTO r FROM public.get_broadcast_progress() WHERE job_id = v_job;
  ASSERT r.audience = 3000, format('audience deveria ser 3000, veio %s', r.audience);
  ASSERT r.sent = 2400 AND r.failed = 100, 'contagem por mensagem divergiu';
  ASSERT r.pending = 500, format('pending deveria ser 3000-2400-100 = 500, veio %s', r.pending);
  -- O contador salvo no job está estourado de propósito (9999). A função
  -- devolve os dois lados: o código antigo fazia Math.max e escondia isso.
  ASSERT r.job_delivered = 9999, 'contador do job deveria vir cru, para a tela mostrar divergência';
  ASSERT r.delivered = 2200, 'a contagem real não pode ser contaminada pelo contador do job';

  -- ── 6. Lotes de fluxo: mesmo fluxo, mesmo dia, dois disparos ──────────────
  SELECT count(*) INTO v_n FROM public.get_flow_progress();
  ASSERT v_n = 2, format('deveriam existir 2 lotes (gap de 5h), veio %s', v_n);
  SELECT * INTO r FROM public.get_flow_progress() ORDER BY batch_started_at LIMIT 1;
  ASSERT r.total = 50, format('primeiro lote deveria ter 50 execuções, veio %s', r.total);
  ASSERT r.sent = 40 AND r.failed = 5 AND r.pending = 5, 'quebra do primeiro lote errada';

  -- Gap maior que a distância entre os lotes junta tudo num só.
  SELECT count(*) INTO v_n FROM public.get_flow_progress(NULL, 600);
  ASSERT v_n = 1, format('com gap de 10h deveria virar 1 lote, veio %s', v_n);

  -- ── 7. Recorte por período ────────────────────────────────────────────────
  SELECT count(*) INTO v_n
    FROM public.get_sending_metrics_by_source(timestamptz '2026-08-20 12:00:00+00')
    WHERE source = 'flow';
  ASSERT v_n = 1, 'p_since deveria manter a origem fluxo';
  SELECT sent INTO v_n
    FROM public.get_sending_metrics_by_source(timestamptz '2026-08-20 12:00:00+00')
    WHERE source = 'flow';
  ASSERT v_n = 20, format('p_since deveria deixar só o lote da tarde (20), veio %s', v_n);

  RAISE NOTICE 'sending_metrics_check: OK (7 blocos)';
END $$;

ROLLBACK;
