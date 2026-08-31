-- Um alvo criado depois dos outros começa com assigned_count = 0. O rateio
-- proporcional então enxerga um déficit enorme nele e manda TODOS os leads
-- novos para essa pessoa até o histórico empatar — foi o que aconteceu na
-- conta do Estevão (colegas em ~50, a nova em 38: tudo caiu nela).
-- Correção: alvo novo entra na fila já "em dia" com a expectativa do time.

CREATE OR REPLACE FUNCTION public.seed_lead_distribution_target()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_total_weight numeric;
  v_total_assigned numeric;
BEGIN
  IF NEW.assigned_count IS NOT NULL AND NEW.assigned_count > 0 THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(sum(weight_percent), 0), coalesce(sum(assigned_count), 0)
    INTO v_total_weight, v_total_assigned
    FROM public.lead_distribution_targets
   WHERE owner_id = NEW.owner_id
     AND member_user_id <> NEW.member_user_id;

  IF v_total_weight > 0 AND v_total_assigned > 0 AND coalesce(NEW.weight_percent, 0) > 0 THEN
    NEW.assigned_count := floor(
      v_total_assigned * (NEW.weight_percent / (v_total_weight + NEW.weight_percent))
    )::integer;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_lead_distribution_target ON public.lead_distribution_targets;
CREATE TRIGGER trg_seed_lead_distribution_target
  BEFORE INSERT ON public.lead_distribution_targets
  FOR EACH ROW EXECUTE FUNCTION public.seed_lead_distribution_target();

REVOKE ALL ON FUNCTION public.seed_lead_distribution_target() FROM anon, authenticated, public;

-- Reequilíbrio único: alinha cada contador à fatia proporcional do histórico
-- do time, zerando os déficits acumulados e devolvendo o rodízio ao normal.
WITH totals AS (
  SELECT owner_id,
         sum(weight_percent) FILTER (WHERE active AND weight_percent > 0) AS w,
         sum(assigned_count)  FILTER (WHERE active AND weight_percent > 0) AS a
    FROM public.lead_distribution_targets
   GROUP BY owner_id
)
UPDATE public.lead_distribution_targets t
   SET assigned_count = round(totals.a * (t.weight_percent / totals.w))::integer,
       updated_at = now()
  FROM totals
 WHERE t.owner_id = totals.owner_id
   AND t.active
   AND t.weight_percent > 0
   AND totals.w > 0
   AND totals.a > 0;