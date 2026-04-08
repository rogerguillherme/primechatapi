
-- Add user_id to leads table
ALTER TABLE public.leads ADD COLUMN user_id uuid;

-- Backfill leads that have messages linked to whatsapp_accounts
UPDATE public.leads l
SET user_id = sub.owner_user_id
FROM (
  SELECT DISTINCT ON (cm.lead_id) cm.lead_id, wa.user_id AS owner_user_id
  FROM chat_messages cm
  JOIN whatsapp_accounts wa ON cm.account_id = wa.id
  WHERE cm.account_id IS NOT NULL
  ORDER BY cm.lead_id, cm.created_at DESC
) sub
WHERE l.id = sub.lead_id AND l.user_id IS NULL;

-- Backfill remaining leads (legacy messages with NULL account_id) to Kauan
UPDATE public.leads SET user_id = '3d0d65a4-0aed-4e86-98e0-5d91e555c354' WHERE user_id IS NULL;

-- Create index for performance
CREATE INDEX idx_leads_user_id ON public.leads (user_id);

-- Drop old open RLS policy on leads
DROP POLICY IF EXISTS "Authenticated users can manage leads" ON public.leads;

-- Create isolated RLS policies for leads
CREATE POLICY "Users can view own leads" ON public.leads FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own leads" ON public.leads FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own leads" ON public.leads FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own leads" ON public.leads FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Service can manage all leads" ON public.leads FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Drop old open RLS policy on chat_messages
DROP POLICY IF EXISTS "Authenticated users can manage chat_messages" ON public.chat_messages;

-- Create isolated RLS policies for chat_messages (via lead's user_id)
CREATE POLICY "Users can view own chat_messages" ON public.chat_messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM leads WHERE leads.id = chat_messages.lead_id AND leads.user_id = auth.uid()));
CREATE POLICY "Users can insert own chat_messages" ON public.chat_messages FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM leads WHERE leads.id = chat_messages.lead_id AND leads.user_id = auth.uid()));
CREATE POLICY "Users can update own chat_messages" ON public.chat_messages FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM leads WHERE leads.id = chat_messages.lead_id AND leads.user_id = auth.uid()));
CREATE POLICY "Users can delete own chat_messages" ON public.chat_messages FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM leads WHERE leads.id = chat_messages.lead_id AND leads.user_id = auth.uid()));
CREATE POLICY "Service can manage all chat_messages" ON public.chat_messages FOR ALL TO service_role USING (true) WITH CHECK (true);
