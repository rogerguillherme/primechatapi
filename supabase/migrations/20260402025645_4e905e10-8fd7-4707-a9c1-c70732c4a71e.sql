UPDATE public.whatsapp_accounts wa
SET user_id = mc.user_id
FROM public.meta_connections mc
WHERE wa.phone_number_id = mc.phone_number_id
  AND mc.status = 'connected'
  AND wa.user_id != mc.user_id;