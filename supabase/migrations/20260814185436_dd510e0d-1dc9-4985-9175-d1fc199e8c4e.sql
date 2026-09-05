ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS home_view text NOT NULL DEFAULT 'broadcast';

CREATE OR REPLACE FUNCTION public.validate_profile_home_view()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.home_view NOT IN ('broadcast', 'service') THEN
    RAISE EXCEPTION 'home_view inválido: %, use ''broadcast'' ou ''service''', NEW.home_view;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_profile_home_view_trigger ON public.profiles;
CREATE TRIGGER validate_profile_home_view_trigger
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.validate_profile_home_view();