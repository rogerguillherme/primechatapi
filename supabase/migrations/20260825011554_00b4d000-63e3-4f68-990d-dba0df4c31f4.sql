CREATE TABLE public.stage_automations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  trigger_type text NOT NULL DEFAULT 'inbound_message',
  keywords text[] NOT NULL DEFAULT '{}',
  from_stage_id uuid REFERENCES public.pipeline_stages(id) ON DELETE SET NULL,
  to_stage_id uuid NOT NULL REFERENCES public.pipeline_stages(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stage_automations TO authenticated;
GRANT ALL ON public.stage_automations TO service_role;

ALTER TABLE public.stage_automations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own stage automations"
ON public.stage_automations FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_stage_automations_user_active ON public.stage_automations(user_id, active);

CREATE TRIGGER update_stage_automations_updated_at
BEFORE UPDATE ON public.stage_automations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.validate_stage_automation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.trigger_type NOT IN ('inbound_message', 'keyword', 'outbound_message', 'send_failed', 'order_approved') THEN
    RAISE EXCEPTION 'trigger_type inválido: %', NEW.trigger_type;
  END IF;
  IF NEW.trigger_type = 'keyword' AND coalesce(array_length(NEW.keywords, 1), 0) = 0 THEN
    RAISE EXCEPTION 'informe ao menos uma palavra-chave';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_stage_automation_trigger
BEFORE INSERT OR UPDATE ON public.stage_automations
FOR EACH ROW EXECUTE FUNCTION public.validate_stage_automation();