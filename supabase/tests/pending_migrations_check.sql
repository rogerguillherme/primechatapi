-- Ensaio das migrations pendentes antes de aplicá-las em produção.
--
--   psql -U postgres -h localhost -d postgres -v ON_ERROR_STOP=1 \
--        -f supabase/tests/pending_migrations_check.sql
--
-- Monta o esqueleto mínimo de que elas dependem e carrega os ARQUIVOS DE
-- VERDADE, na mesma ordem em que o Supabase aplicaria. Serve para descobrir
-- coluna errada, dependência faltando e erro de sintaxe aqui, e não no meio da
-- aplicação em produção — migration que falha pela metade deixa o banco num
-- estado que ninguém pediu.
--
-- ATENÇÃO: aponte para um Postgres descartável. O script recria o schema
-- `public` do banco em que roda.

\set ON_ERROR_STOP on
BEGIN;

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;

-- ── Esqueleto: só o que as migrations tocam ──
CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  assigned_to uuid,
  name text, phone text, email text,
  hubla_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  checkout_name text
);

CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  lead_id uuid REFERENCES public.leads(id),
  product_id uuid REFERENCES public.products(id),
  external_order_id text NOT NULL UNIQUE,
  amount numeric(10,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  payment_method text,
  webhook_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.chat_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL, name text, color text, stage_id uuid
);
CREATE TABLE public.lead_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id),
  label_id uuid NOT NULL REFERENCES public.chat_labels(id)
);
CREATE TABLE public.flows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, name text
);
CREATE TABLE public.flow_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), flow_id uuid NOT NULL REFERENCES public.flows(id)
);
CREATE TABLE public.flow_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id uuid NOT NULL REFERENCES public.flows(id),
  lead_id uuid NOT NULL REFERENCES public.leads(id),
  status text, next_action_at timestamptz, created_at timestamptz DEFAULT now()
);
CREATE TABLE public.chat_shortcuts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, command text
);
CREATE TABLE public.chat_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, content text
);
CREATE TABLE public.team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL, member_user_id uuid NOT NULL,
  access_level text NOT NULL DEFAULT 'chat', lead_scope text NOT NULL DEFAULT 'all'
);

ALTER TABLE public.chat_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flow_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flow_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_shortcuts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE TYPE public.app_role AS ENUM ('admin', 'user');
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL, role public.app_role NOT NULL
);
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _user_id AND r.role = _role)
$$;

CREATE OR REPLACE FUNCTION public.team_access_level(_owner uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN _owner = auth.uid() THEN 'owner'
    ELSE (SELECT tm.access_level FROM public.team_members tm
          WHERE tm.owner_id = _owner AND tm.member_user_id = auth.uid() LIMIT 1) END
$$;

CREATE OR REPLACE FUNCTION public.team_lead_scope(_owner uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN _owner = auth.uid() THEN 'all'
    ELSE coalesce((SELECT tm.lead_scope FROM public.team_members tm
          WHERE tm.owner_id = _owner AND tm.member_user_id = auth.uid() LIMIT 1), 'none') END
$$;

-- Políticas antigas, para os DROP das migrations terem o que derrubar.
CREATE POLICY "Users can manage own chat_labels" ON public.chat_labels FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can manage own lead_labels" ON public.lead_labels FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY "Users can view own flows" ON public.flows FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own flows" ON public.flows FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own flows" ON public.flows FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own flows" ON public.flows FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own flow_steps" ON public.flow_steps FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Users can manage own flow_executions" ON public.flow_executions FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Users manage their own chat shortcuts" ON public.chat_shortcuts FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can view own templates" ON public.chat_templates FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own templates" ON public.chat_templates FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own templates" ON public.chat_templates FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own templates" ON public.chat_templates FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ── As migrations de verdade, na ordem de aplicação ──
\ir ../migrations/20260827180000_sales_module.sql
\ir ../migrations/20260827200000_team_access_labels.sql
\ir ../migrations/20260827210000_team_access_chat_tools.sql

-- ── O que precisa existir depois ──
DO $$
DECLARE faltando text;
BEGIN
  SELECT string_agg(f, ', ') INTO faltando FROM unnest(ARRAY[
    'search_orders','list_buyers','get_sales_summary','order_net_amount'
  ]) f
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = f);
  ASSERT faltando IS NULL, 'funções não criadas: ' || faltando;

  SELECT string_agg(t.tbl || '/' || t.pol, ', ') INTO faltando
  FROM (VALUES
    ('flows','Team can view flows'),
    ('flow_steps','Team can view flow_steps'),
    ('flow_executions','Team can manage flow_executions'),
    ('chat_shortcuts','Team can view chat_shortcuts'),
    ('chat_templates','Team can view chat_templates'),
    ('chat_labels','Team can view chat_labels'),
    ('lead_labels','Team can view lead_labels')
  ) AS t(tbl, pol)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = t.tbl AND policyname = t.pol);
  ASSERT faltando IS NULL, 'políticas não criadas: ' || faltando;

  -- As antigas precisam ter saído: conviver com elas devolveria o acesso
  -- amplo que a migration veio restringir.
  SELECT string_agg(policyname, ', ') INTO faltando FROM pg_policies
  WHERE policyname IN (
    'Users can view own flows','Users manage their own chat shortcuts',
    'Users can manage own chat_labels','Users can view own templates');
  ASSERT faltando IS NULL, 'políticas antigas sobreviveram: ' || faltando;
END $$;

-- ── A busca precisa responder, não só existir ──
DO $$
DECLARE owner_id uuid := gen_random_uuid(); lead_id uuid; n int;
BEGIN
  PERFORM set_config('test.uid', owner_id::text, true);
  INSERT INTO public.leads (user_id, name, phone, email)
    VALUES (owner_id, 'Maria Aparecida', '5511999998888', 'maria@exemplo.com')
    RETURNING id INTO lead_id;
  INSERT INTO public.orders (user_id, lead_id, external_order_id, amount, status)
    VALUES (owner_id, lead_id, 'PED-1', 199.90, 'approved');

  SELECT count(*) INTO n FROM public.search_orders('Maria');
  ASSERT n = 1, 'busca por nome não achou o pedido';
  SELECT count(*) INTO n FROM public.search_orders('99999');
  ASSERT n = 1, 'busca por telefone não achou o pedido';
  SELECT count(*) INTO n FROM public.search_orders('maria@exemplo.com');
  ASSERT n = 1, 'busca por e-mail não achou o pedido';
  SELECT count(*) INTO n FROM public.search_orders('Joao');
  ASSERT n = 0, 'busca trouxe pedido que não é do termo';
END $$;

ROLLBACK;

\echo 'pending_migrations_check: OK — as tres migrations aplicam limpas'
