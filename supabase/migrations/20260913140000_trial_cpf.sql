-- CPF no cadastro de teste grátis — trava um segundo teste do mesmo CPF com
-- e-mail diferente.
--
-- Coluna nullable de propósito: conta criada pelo admin (trial_ends_at NULL)
-- nunca coletou CPF, e Postgres permite múltiplos NULL numa constraint
-- UNIQUE — só CPF repetido entre dois cadastros de teste é barrado.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS cpf text;

DO $$ BEGIN
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_cpf_unique UNIQUE (cpf);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (user_id, display_name, avatar_url, trial_ends_at, cpf)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url',
    CASE WHEN NEW.raw_user_meta_data->>'signup_source' = 'trial'
      THEN now() + interval '7 days' ELSE NULL END,
    NULLIF(NEW.raw_user_meta_data->>'cpf', '')
  );
  RETURN NEW;
END;
$function$;
