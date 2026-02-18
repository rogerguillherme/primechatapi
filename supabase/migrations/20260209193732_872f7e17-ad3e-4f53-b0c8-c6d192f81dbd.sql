
-- Replace sequential code with Hubla's client ID
ALTER TABLE public.leads ADD COLUMN hubla_id TEXT;

-- Populate from existing webhook data
UPDATE public.leads l
SET hubla_id = sub.payer_id
FROM (
  SELECT DISTINCT ON (o.lead_id) 
    o.lead_id,
    o.webhook_payload->'event'->'invoice'->'payer'->>'id' as payer_id
  FROM orders o
  WHERE o.webhook_payload->'event'->'invoice'->'payer'->>'id' IS NOT NULL
  ORDER BY o.lead_id, o.created_at DESC
) sub
WHERE l.id = sub.lead_id;

-- Drop the sequential code column
ALTER TABLE public.leads DROP COLUMN code;
