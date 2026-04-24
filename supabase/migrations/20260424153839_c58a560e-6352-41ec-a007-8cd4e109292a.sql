-- 1) Adiciona campo de variações de mensagem em cada passo do fluxo
-- message_variations: array JSON de strings com versões alternativas da mensagem
ALTER TABLE public.flow_steps
  ADD COLUMN IF NOT EXISTS message_variations jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Override de delay por nó (segundos): se preenchido, ignora config global do fluxo
ALTER TABLE public.flow_steps
  ADD COLUMN IF NOT EXISTS delay_min_seconds integer,
  ADD COLUMN IF NOT EXISTS delay_max_seconds integer;

-- 2) Configurações globais por fluxo (variação + tempo + janela horária)
ALTER TABLE public.flows
  ADD COLUMN IF NOT EXISTS variation_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS delay_min_seconds integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS delay_max_seconds integer NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS sending_window_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sending_window_start time NOT NULL DEFAULT '09:00:00',
  ADD COLUMN IF NOT EXISTS sending_window_end time NOT NULL DEFAULT '18:00:00',
  ADD COLUMN IF NOT EXISTS sending_window_timezone text NOT NULL DEFAULT 'America/Sao_Paulo';

-- 3) Validação via trigger (CHECK constraints podem causar problemas em alterações futuras)
CREATE OR REPLACE FUNCTION public.validate_flow_timing()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.delay_min_seconds < 0 OR NEW.delay_max_seconds < 0 THEN
    RAISE EXCEPTION 'delays não podem ser negativos';
  END IF;
  IF NEW.delay_min_seconds > NEW.delay_max_seconds THEN
    RAISE EXCEPTION 'delay_min_seconds (%) não pode ser maior que delay_max_seconds (%)', NEW.delay_min_seconds, NEW.delay_max_seconds;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_flow_timing_trigger ON public.flows;
CREATE TRIGGER validate_flow_timing_trigger
  BEFORE INSERT OR UPDATE ON public.flows
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_flow_timing();

CREATE OR REPLACE FUNCTION public.validate_flow_step_timing()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.delay_min_seconds IS NOT NULL AND NEW.delay_min_seconds < 0 THEN
    RAISE EXCEPTION 'delay_min_seconds não pode ser negativo';
  END IF;
  IF NEW.delay_max_seconds IS NOT NULL AND NEW.delay_max_seconds < 0 THEN
    RAISE EXCEPTION 'delay_max_seconds não pode ser negativo';
  END IF;
  IF NEW.delay_min_seconds IS NOT NULL AND NEW.delay_max_seconds IS NOT NULL
     AND NEW.delay_min_seconds > NEW.delay_max_seconds THEN
    RAISE EXCEPTION 'delay_min_seconds (%) não pode ser maior que delay_max_seconds (%)', NEW.delay_min_seconds, NEW.delay_max_seconds;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_flow_step_timing_trigger ON public.flow_steps;
CREATE TRIGGER validate_flow_step_timing_trigger
  BEFORE INSERT OR UPDATE ON public.flow_steps
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_flow_step_timing();