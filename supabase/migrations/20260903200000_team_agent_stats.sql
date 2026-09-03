-- Métricas por atendente: quantos leads cada colaborador tem atribuído, quantos
-- chegaram hoje, taxa de resposta e tempo médio de resposta.
--
-- Agrega no banco de propósito: contar no navegador esbarra no teto de 1.000
-- linhas do PostgREST e trunca em silêncio (já visto neste projeto em
-- 20260827150000_sending_metrics_by_source.sql).
--
-- SECURITY DEFINER precisa validar o chamador explicitamente — ele ignora RLS,
-- então sem o check qualquer usuário autenticado poderia pedir estatísticas de
-- qualquer conta só passando o owner_id de outra empresa.
CREATE OR REPLACE FUNCTION public.get_team_agent_stats(p_owner_id uuid)
RETURNS TABLE(
  member_user_id uuid,
  total_leads bigint,
  leads_today bigint,
  response_rate numeric,
  avg_response_time_minutes numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF public.team_access_level(p_owner_id) IS NULL THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  SELECT
    m.member_user_id,
    count(l.id) AS total_leads,
    count(l.id) FILTER (WHERE l.created_at >= date_trunc('day', now())) AS leads_today,
    CASE WHEN count(l.id) FILTER (WHERE l.last_outbound_at IS NOT NULL) = 0 THEN 0
      ELSE round(
        count(l.id) FILTER (WHERE l.last_inbound_at IS NOT NULL AND l.last_outbound_at IS NOT NULL)::numeric
        / count(l.id) FILTER (WHERE l.last_outbound_at IS NOT NULL)::numeric * 100, 1)
    END AS response_rate,
    coalesce(round(avg(
      EXTRACT(EPOCH FROM (l.last_inbound_at - l.last_outbound_at)) / 60
    ) FILTER (
      WHERE l.last_inbound_at IS NOT NULL AND l.last_outbound_at IS NOT NULL
        AND l.last_inbound_at > l.last_outbound_at
    )::numeric, 1), 0) AS avg_response_time_minutes
  FROM (
    SELECT p_owner_id AS member_user_id
    UNION
    SELECT tm.member_user_id FROM public.team_members tm WHERE tm.owner_id = p_owner_id
  ) m
  LEFT JOIN public.leads l ON l.user_id = p_owner_id AND l.assigned_to = m.member_user_id
  GROUP BY m.member_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_team_agent_stats(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_team_agent_stats(uuid) TO authenticated;
