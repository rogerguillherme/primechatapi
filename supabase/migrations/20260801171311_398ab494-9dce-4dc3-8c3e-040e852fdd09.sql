ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS last_message_content text,
  ADD COLUMN IF NOT EXISTS last_message_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_message_direction text,
  ADD COLUMN IF NOT EXISTS last_message_status text,
  ADD COLUMN IF NOT EXISTS last_message_account_id uuid,
  ADD COLUMN IF NOT EXISTS account_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[];

CREATE OR REPLACE FUNCTION public.sync_lead_last_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.leads l
  SET last_message_content = left(NEW.content, 500),
      last_message_at = NEW.created_at,
      last_message_direction = NEW.direction,
      last_message_status = NEW.status,
      last_message_account_id = NEW.account_id,
      account_ids = CASE
        WHEN NEW.account_id IS NULL OR NEW.account_id = ANY(l.account_ids) THEN l.account_ids
        ELSE l.account_ids || NEW.account_id
      END
  WHERE l.id = NEW.lead_id
    AND (l.last_message_at IS NULL OR NEW.created_at >= l.last_message_at);

  IF NEW.account_id IS NOT NULL THEN
    UPDATE public.leads l
    SET account_ids = l.account_ids || NEW.account_id
    WHERE l.id = NEW.lead_id AND NOT (NEW.account_id = ANY(l.account_ids));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_lead_last_message ON public.chat_messages;
CREATE TRIGGER trg_sync_lead_last_message
AFTER INSERT OR UPDATE OF status, content ON public.chat_messages
FOR EACH ROW EXECUTE FUNCTION public.sync_lead_last_message();

WITH latest AS (
  SELECT DISTINCT ON (m.lead_id) m.lead_id, m.content, m.created_at, m.direction, m.status, m.account_id
  FROM public.chat_messages m
  ORDER BY m.lead_id, m.created_at DESC
), accts AS (
  SELECT m.lead_id, array_agg(DISTINCT m.account_id) AS ids
  FROM public.chat_messages m WHERE m.account_id IS NOT NULL GROUP BY m.lead_id
)
UPDATE public.leads l
SET last_message_content = left(latest.content, 500),
    last_message_at = latest.created_at,
    last_message_direction = latest.direction,
    last_message_status = latest.status,
    last_message_account_id = latest.account_id,
    account_ids = COALESCE(accts.ids, ARRAY[]::uuid[])
FROM latest LEFT JOIN accts ON accts.lead_id = latest.lead_id
WHERE l.id = latest.lead_id;

CREATE INDEX IF NOT EXISTS idx_leads_last_message_at ON public.leads (last_message_at DESC NULLS LAST);

DROP FUNCTION IF EXISTS public.get_chat_lead_summaries(integer);