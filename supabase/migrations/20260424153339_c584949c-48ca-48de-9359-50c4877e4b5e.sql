-- Adiciona flow_kind para distinguir fluxos por provedor (api = Meta Cloud, whatsapp = 360Messenger/d360)
ALTER TABLE public.flows
  ADD COLUMN IF NOT EXISTS flow_kind text NOT NULL DEFAULT 'api';

-- Garante valores válidos via trigger (CHECK constraints podem ser problemáticos para alterações futuras)
CREATE OR REPLACE FUNCTION public.validate_flow_kind()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.flow_kind NOT IN ('api', 'whatsapp') THEN
    RAISE EXCEPTION 'flow_kind inválido: %, use ''api'' ou ''whatsapp''', NEW.flow_kind;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_flow_kind_trigger ON public.flows;
CREATE TRIGGER validate_flow_kind_trigger
  BEFORE INSERT OR UPDATE ON public.flows
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_flow_kind();

CREATE INDEX IF NOT EXISTS idx_flows_flow_kind ON public.flows(flow_kind);