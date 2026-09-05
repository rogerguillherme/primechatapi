-- 1. Settings table
CREATE TABLE public.lead_distribution_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id uuid NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT false,
  trigger_mode text NOT NULL DEFAULT 'first_inbound' CHECK (trigger_mode IN ('first_inbound','any_unassigned','lead_created')),
  waiting_stage_id uuid REFERENCES public.pipeline_stages(id) ON DELETE SET NULL,
  in_service_stage_id uuid REFERENCES public.pipeline_stages(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_distribution_settings TO authenticated;
GRANT ALL ON public.lead_distribution_settings TO service_role;
ALTER TABLE public.lead_distribution_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner manages distribution settings"
  ON public.lead_distribution_settings FOR ALL TO authenticated
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Team can view distribution settings"
  ON public.lead_distribution_settings FOR SELECT TO authenticated
  USING (public.team_access_level(owner_id) IS NOT NULL);

CREATE TRIGGER update_lead_distribution_settings_updated_at
  BEFORE UPDATE ON public.lead_distribution_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Targets table (weighted distribution)
CREATE TABLE public.lead_distribution_targets (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id uuid NOT NULL,
  member_user_id uuid NOT NULL,
  weight_percent numeric NOT NULL DEFAULT 0 CHECK (weight_percent >= 0 AND weight_percent <= 100),
  active boolean NOT NULL DEFAULT true,
  assigned_count integer NOT NULL DEFAULT 0,
  last_assigned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, member_user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_distribution_targets TO authenticated;
GRANT ALL ON public.lead_distribution_targets TO service_role;
ALTER TABLE public.lead_distribution_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner manages distribution targets"
  ON public.lead_distribution_targets FOR ALL TO authenticated
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Team can view distribution targets"
  ON public.lead_distribution_targets FOR SELECT TO authenticated
  USING (public.team_access_level(owner_id) IS NOT NULL);

CREATE TRIGGER update_lead_distribution_targets_updated_at
  BEFORE UPDATE ON public.lead_distribution_targets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_ldt_owner ON public.lead_distribution_targets(owner_id) WHERE active;

-- 3. Distribution core: weighted (lowest achieved-share vs target-share wins)
CREATE OR REPLACE FUNCTION public.distribute_lead(p_lead_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_assigned uuid;
  v_settings public.lead_distribution_settings;
  v_target uuid;
  v_total_weight numeric;
  v_total_assigned integer;
BEGIN
  SELECT user_id, assigned_to INTO v_owner, v_assigned FROM public.leads WHERE id = p_lead_id;
  IF v_owner IS NULL OR v_assigned IS NOT NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_settings FROM public.lead_distribution_settings WHERE owner_id = v_owner;
  IF v_settings.id IS NULL OR v_settings.enabled = false THEN
    RETURN NULL;
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

-- 4. Trigger on inbound messages
CREATE OR REPLACE FUNCTION public.distribute_lead_on_inbound()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_mode text;
  v_prior integer;
BEGIN
  IF NEW.direction <> 'inbound' THEN
    RETURN NEW;
  END IF;

  SELECT l.user_id INTO v_owner FROM public.leads l WHERE l.id = NEW.lead_id;
  IF v_owner IS NULL THEN RETURN NEW; END IF;

  SELECT trigger_mode INTO v_mode
    FROM public.lead_distribution_settings
    WHERE owner_id = v_owner AND enabled;
  IF v_mode IS NULL OR v_mode = 'lead_created' THEN
    RETURN NEW;
  END IF;

  IF v_mode = 'first_inbound' THEN
    SELECT count(*) INTO v_prior FROM public.chat_messages
      WHERE lead_id = NEW.lead_id AND direction = 'inbound' AND id <> NEW.id;
    IF v_prior > 0 THEN RETURN NEW; END IF;
  END IF;

  PERFORM public.distribute_lead(NEW.lead_id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_distribute_lead_on_inbound
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.distribute_lead_on_inbound();

-- 5. Trigger on lead creation
CREATE OR REPLACE FUNCTION public.distribute_lead_on_create()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings public.lead_distribution_settings;
BEGIN
  IF NEW.user_id IS NULL OR NEW.assigned_to IS NOT NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_settings FROM public.lead_distribution_settings WHERE owner_id = NEW.user_id AND enabled;
  IF v_settings.id IS NULL THEN RETURN NEW; END IF;

  IF v_settings.trigger_mode = 'lead_created' THEN
    PERFORM public.distribute_lead(NEW.id);
  ELSIF v_settings.waiting_stage_id IS NOT NULL AND NEW.stage_id IS NULL THEN
    UPDATE public.leads SET stage_id = v_settings.waiting_stage_id WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_distribute_lead_on_create
  AFTER INSERT ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.distribute_lead_on_create();

REVOKE EXECUTE ON FUNCTION public.distribute_lead(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.distribute_lead(uuid) TO authenticated, service_role;

-- Seed de dados removido durante a migração Lovable -> Supabase próprio:
-- populava pipeline_stages + lead_distribution_settings para um usuário específico
-- (owner_id 44c78035-7cdb-4e8e-8e22-beaba931b549). Será recriado a partir da origem
-- separadamente. Conteúdo original preservado no histórico do Git.
-- Ver HANDOFF-migracao-primechat.md.
