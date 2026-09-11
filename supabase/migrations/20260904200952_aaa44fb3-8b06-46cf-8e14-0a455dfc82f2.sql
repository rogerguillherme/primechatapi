ALTER TABLE public.orders ALTER COLUMN lead_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.get_team_today_stats(p_owner_id uuid)
RETURNS TABLE(
  member_user_id uuid,
  leads_today bigint,
  messages_sent_today bigint,
  replies_today bigint,
  sales_today bigint,
  revenue_today numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_inicio timestamptz := date_trunc('day', now());
BEGIN
  IF public.team_access_level(p_owner_id) IS NULL THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  WITH membros AS (
    SELECT p_owner_id AS member_user_id
    UNION
    SELECT tm.member_user_id FROM public.team_members tm WHERE tm.owner_id = p_owner_id
  ),
  leads_do_dono AS (
    SELECT l.id, l.assigned_to, l.created_at, l.last_inbound_at
    FROM public.leads l
    WHERE l.user_id = p_owner_id
  ),
  por_lead AS (
    SELECT
      ld.assigned_to AS membro,
      count(*) FILTER (WHERE ld.created_at >= v_inicio) AS leads_today,
      count(*) FILTER (WHERE ld.last_inbound_at >= v_inicio) AS replies_today
    FROM leads_do_dono ld
    GROUP BY ld.assigned_to
  ),
  mensagens AS (
    SELECT coalesce(cm.sent_by, ld.assigned_to) AS membro, count(*) AS enviadas
    FROM public.chat_messages cm
    JOIN leads_do_dono ld ON ld.id = cm.lead_id
    WHERE cm.created_at >= v_inicio AND cm.direction = 'outbound'
    GROUP BY coalesce(cm.sent_by, ld.assigned_to)
  ),
  vendas AS (
    SELECT ld.assigned_to AS membro, count(*) AS qtd, coalesce(sum(o.amount), 0) AS total
    FROM public.orders o
    JOIN leads_do_dono ld ON ld.id = o.lead_id
    WHERE o.created_at >= v_inicio AND o.status = 'approved'
    GROUP BY ld.assigned_to
  )
  SELECT
    m.member_user_id,
    coalesce(pl.leads_today, 0),
    coalesce(msg.enviadas, 0),
    coalesce(pl.replies_today, 0),
    coalesce(v.qtd, 0),
    coalesce(v.total, 0)
  FROM membros m
  LEFT JOIN por_lead pl ON pl.membro = m.member_user_id
  LEFT JOIN mensagens msg ON msg.membro = m.member_user_id
  LEFT JOIN vendas v ON v.membro = m.member_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_team_today_stats(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_team_today_stats(uuid) TO authenticated, service_role;