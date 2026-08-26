-- Lead que volta fica com o mesmo vendedor.
-- Hoje distribute_lead sai fora quando assigned_to IS NOT NULL, então o lead com
-- dono mantém o dono. O furo é o lead DESATRIBUÍDO: ao voltar a falar ele cai no
-- rodízio e vai para outro vendedor.

ALTER TABLE public.lead_distribution_settings
  ADD COLUMN IF NOT EXISTS sticky_agent boolean NOT NULL DEFAULT false;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS last_assigned_to uuid;

-- Memória do último responsável. Preenchida sempre que assigned_to recebe um
-- valor e PRESERVADA quando ele é limpo.
-- Sem backfill de propósito: leads existentes seriam todos reescritos e o
-- trigger update_leads_updated_at jogaria updated_at = now() em cada um,
-- reordenando a lista de conversas inteira. O ramo ELSIF cobre esses leads
-- antigos no momento exato em que eles são desatribuídos.
CREATE OR REPLACE FUNCTION public.remember_last_assigned()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.assigned_to IS NOT NULL THEN
    NEW.last_assigned_to := NEW.assigned_to;
  ELSIF TG_OP = 'UPDATE' AND OLD.assigned_to IS NOT NULL THEN
    NEW.last_assigned_to := OLD.assigned_to;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_remember_last_assigned ON public.leads;
CREATE TRIGGER trg_remember_last_assigned
  BEFORE INSERT OR UPDATE OF assigned_to ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.remember_last_assigned();

-- distribute_lead: mesma função de antes + o desvio de stickiness antes do rodízio.
CREATE OR REPLACE FUNCTION public.distribute_lead(p_lead_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_assigned uuid;
  v_last uuid;
  v_settings public.lead_distribution_settings;
  v_target uuid;
  v_total_weight numeric;
  v_total_assigned integer;
BEGIN
  SELECT user_id, assigned_to, last_assigned_to
    INTO v_owner, v_assigned, v_last
    FROM public.leads WHERE id = p_lead_id;
  IF v_owner IS NULL OR v_assigned IS NOT NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_settings FROM public.lead_distribution_settings WHERE owner_id = v_owner;
  IF v_settings.id IS NULL OR v_settings.enabled = false THEN
    RETURN NULL;
  END IF;

  -- Lead que já teve dono volta para ele, desde que ainda seja um target ATIVO.
  -- Vendedor inativo (saiu da equipe, foi desmarcado) cai no rodízio normal —
  -- lead nenhum fica preso a quem não atende mais.
  -- weight_percent não entra aqui: peso 0 significa "não quero leads NOVOS",
  -- e devolver um lead antigo não é um lead novo.
  IF v_settings.sticky_agent AND v_last IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.lead_distribution_targets
     WHERE owner_id = v_owner AND member_user_id = v_last AND active
  ) THEN
    UPDATE public.leads
      SET assigned_to = v_last,
          stage_id = coalesce(v_settings.in_service_stage_id, stage_id),
          updated_at = now()
      WHERE id = p_lead_id AND assigned_to IS NULL;

    IF NOT FOUND THEN
      RETURN NULL;
    END IF;

    -- assigned_count NÃO é incrementado: ele é o denominador do rateio
    -- proporcional. Contar um retorno como lead novo empurraria o vendedor
    -- para o fim da fila e encolheria, na prática, a fatia de quem mais
    -- recebe leads de volta.
    RETURN v_last;
  END IF;

  SELECT coalesce(sum(weight_percent), 0), coalesce(sum(assigned_count), 0)
    INTO v_total_weight, v_total_assigned
    FROM public.lead_distribution_targets
    WHERE owner_id = v_owner AND active AND weight_percent > 0;

  IF v_total_weight <= 0 THEN
    RETURN NULL;
  END IF;

  -- pick the participant furthest below its target share
  SELECT member_user_id INTO v_target
  FROM public.lead_distribution_targets
  WHERE owner_id = v_owner AND active AND weight_percent > 0
  ORDER BY (assigned_count::numeric - (weight_percent / v_total_weight) * (v_total_assigned + 1)) ASC,
           coalesce(last_assigned_at, 'epoch'::timestamptz) ASC
  LIMIT 1;

  IF v_target IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.leads
    SET assigned_to = v_target,
        stage_id = coalesce(v_settings.in_service_stage_id, stage_id),
        updated_at = now()
    WHERE id = p_lead_id AND assigned_to IS NULL;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.lead_distribution_targets
    SET assigned_count = assigned_count + 1, last_assigned_at = now()
    WHERE owner_id = v_owner AND member_user_id = v_target;

  RETURN v_target;
END;
$$;

REVOKE ALL ON FUNCTION public.distribute_lead(uuid) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.distribute_lead(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.remember_last_assigned() FROM anon, authenticated, public;
