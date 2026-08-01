CREATE INDEX IF NOT EXISTS idx_chat_messages_lead_created ON public.chat_messages (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON public.chat_messages (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_zapi_message_id ON public.chat_messages (zapi_message_id) WHERE zapi_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_messages_account_lead ON public.chat_messages (account_id, lead_id) WHERE account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_updated_at ON public.leads (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_flow_executions_status_next ON public.flow_executions (status, next_action_at);

CREATE OR REPLACE FUNCTION public.get_chat_lead_summaries(p_limit integer DEFAULT 5000)
RETURNS TABLE(lead_id uuid, content text, created_at timestamptz, direction text, status text, account_id uuid, account_ids uuid[])
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH latest AS (
    SELECT DISTINCT ON (m.lead_id)
      m.lead_id, m.content, m.created_at, m.direction, m.status, m.account_id
    FROM public.chat_messages m
    ORDER BY m.lead_id, m.created_at DESC
  ),
  accts AS (
    SELECT m.lead_id, array_agg(DISTINCT m.account_id) AS account_ids
    FROM public.chat_messages m
    WHERE m.account_id IS NOT NULL
    GROUP BY m.lead_id
  )
  SELECT l.lead_id, l.content, l.created_at, l.direction, l.status, l.account_id,
         COALESCE(a.account_ids, ARRAY[]::uuid[])
  FROM latest l
  LEFT JOIN accts a ON a.lead_id = l.lead_id
  ORDER BY l.created_at DESC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.get_chat_lead_summaries(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_chat_lead_summaries(integer) TO authenticated, service_role;