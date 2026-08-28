\set ON_ERROR_STOP on
BEGIN;
DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true),'')::uuid $$;
CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TABLE public.leads (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, assigned_to uuid, name text, phone text);
CREATE TABLE public.chat_messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid REFERENCES public.leads(id), direction text, content text, created_at timestamptz DEFAULT now());
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, type text NOT NULL DEFAULT 'info', title text NOT NULL, message text, link text, read boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

\ir ../migrations/20260828120000_lead_notifications.sql

DO $$
DECLARE dono uuid := gen_random_uuid(); vend uuid := gen_random_uuid(); l uuid; n int;
BEGIN
  INSERT INTO public.leads (user_id, name, phone) VALUES (dono,'Ana','5511999') RETURNING id INTO l;
  SELECT count(*) INTO n FROM public.notifications WHERE user_id=dono AND type='new_lead';
  ASSERT n=1, 'dono nao foi avisado do lead novo';

  UPDATE public.leads SET assigned_to=vend WHERE id=l;
  SELECT count(*) INTO n FROM public.notifications WHERE user_id=vend AND type='assigned_to_me';
  ASSERT n=1, 'vendedor nao foi avisado da atribuicao';

  INSERT INTO public.chat_messages (lead_id, direction, content) VALUES (l,'inbound','oi');
  SELECT count(*) INTO n FROM public.notifications WHERE user_id=vend AND type='new_message';
  ASSERT n=1, 'vendedor nao foi avisado da mensagem';

  -- enxurrada: 50 mensagens nao podem virar 50 avisos
  INSERT INTO public.chat_messages (lead_id, direction, content)
    SELECT l,'inbound','msg '||i FROM generate_series(1,50) i;
  SELECT count(*) INTO n FROM public.notifications WHERE user_id=vend AND type='new_message';
  ASSERT n=1, 'enxurrada gerou '||n||' avisos em vez de 1';

  -- depois de lida, um aviso novo pode entrar
  UPDATE public.notifications SET read=true WHERE user_id=vend AND type='new_message';
  INSERT INTO public.chat_messages (lead_id, direction, content) VALUES (l,'inbound','de novo');
  SELECT count(*) INTO n FROM public.notifications WHERE user_id=vend AND type='new_message' AND read=false;
  ASSERT n=1, 'apos ler, novo aviso nao entrou';

  -- preferencia desligada silencia
  INSERT INTO public.notification_prefs (user_id, new_message) VALUES (vend,false);
  UPDATE public.notifications SET read=true WHERE user_id=vend;
  INSERT INTO public.chat_messages (lead_id, direction, content) VALUES (l,'inbound','ignorada');
  SELECT count(*) INTO n FROM public.notifications WHERE user_id=vend AND read=false;
  ASSERT n=0, 'preferencia desligada nao silenciou';

  -- saida nao notifica
  UPDATE public.notifications SET read=true;
  INSERT INTO public.chat_messages (lead_id, direction, content) VALUES (l,'outbound','resposta');
  SELECT count(*) INTO n FROM public.notifications WHERE read=false;
  ASSERT n=0, 'mensagem enviada gerou aviso';
END $$;
ROLLBACK;
\echo 'notificacoes: OK (6 casos)'
