
-- Drop the admin policy that lets admins see all accounts
DROP POLICY IF EXISTS "Admins can manage all whatsapp_accounts" ON public.whatsapp_accounts;
