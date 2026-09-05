UPDATE public.whatsapp_accounts
SET provider = 'evolution',
    business_account_id = NULL,
    updated_at = now()
WHERE provider = '360messenger';