
-- Add user_id column to whatsapp_accounts
ALTER TABLE public.whatsapp_accounts 
ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- Drop existing permissive policy
DROP POLICY IF EXISTS "Allow all access to whatsapp_accounts" ON public.whatsapp_accounts;

-- Users can only see their own accounts
CREATE POLICY "Users can view own whatsapp_accounts"
ON public.whatsapp_accounts
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Users can insert their own accounts
CREATE POLICY "Users can insert own whatsapp_accounts"
ON public.whatsapp_accounts
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Users can update their own accounts
CREATE POLICY "Users can update own whatsapp_accounts"
ON public.whatsapp_accounts
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

-- Users can delete their own accounts
CREATE POLICY "Users can delete own whatsapp_accounts"
ON public.whatsapp_accounts
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- Admins can see all accounts (needed for admin features)
CREATE POLICY "Admins can manage all whatsapp_accounts"
ON public.whatsapp_accounts
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));
