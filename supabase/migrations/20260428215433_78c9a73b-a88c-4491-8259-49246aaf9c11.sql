
-- Move chat messages that were sent via account "Zero" but landed in a lead owned by another user
-- Step 1: Ensure a lead exists for Roger under Zero's owner (user 36dc3223)
INSERT INTO public.leads (user_id, phone, name, origin, chat_status)
SELECT '36dc3223-cbef-4a16-964b-ff5519f8f0cd', '5542999374244', 'Roger Bendlin', 'evolution', 'aguardando_respostas'
WHERE NOT EXISTS (
  SELECT 1 FROM public.leads
  WHERE phone = '5542999374244' AND user_id = '36dc3223-cbef-4a16-964b-ff5519f8f0cd'
);

-- Step 2: Move chat_messages and update flow_executions to point at the correct lead
WITH zero_lead AS (
  SELECT id FROM public.leads
  WHERE phone = '5542999374244' AND user_id = '36dc3223-cbef-4a16-964b-ff5519f8f0cd'
  LIMIT 1
)
UPDATE public.chat_messages cm
SET lead_id = (SELECT id FROM zero_lead)
WHERE cm.account_id = '126fcdf4-f6c0-439d-b1e9-f257e2da778d'
  AND cm.lead_id = '9119d7ba-50a7-4b31-8bfd-ed838d63e59f';

WITH zero_lead AS (
  SELECT id FROM public.leads
  WHERE phone = '5542999374244' AND user_id = '36dc3223-cbef-4a16-964b-ff5519f8f0cd'
  LIMIT 1
)
UPDATE public.flow_executions fe
SET lead_id = (SELECT id FROM zero_lead)
WHERE fe.lead_id = '9119d7ba-50a7-4b31-8bfd-ed838d63e59f'
  AND (fe.metadata->>'account_id') = '126fcdf4-f6c0-439d-b1e9-f257e2da778d';
