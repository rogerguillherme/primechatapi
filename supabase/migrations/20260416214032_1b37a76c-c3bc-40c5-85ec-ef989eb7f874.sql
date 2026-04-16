WITH single_owner_templates AS (
  SELECT
    at.template_id,
    (array_agg(DISTINCT wa.user_id))[1] AS owner_user_id,
    count(DISTINCT wa.user_id) AS owner_count
  FROM public.account_templates at
  JOIN public.whatsapp_accounts wa ON wa.id = at.account_id
  WHERE wa.user_id IS NOT NULL
  GROUP BY at.template_id
)
UPDATE public.chat_templates ct
SET user_id = sot.owner_user_id
FROM single_owner_templates sot
WHERE ct.id = sot.template_id
  AND ct.user_id IS NULL
  AND sot.owner_count = 1;