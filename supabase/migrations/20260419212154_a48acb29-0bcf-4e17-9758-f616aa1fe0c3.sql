-- ============================================
-- 1. ADD user_id COLUMNS (multi-tenancy)
-- ============================================
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.product_items ADD COLUMN IF NOT EXISTS user_id uuid;

-- Backfill existing rows: assign to lead's owner where possible
UPDATE public.orders o
SET user_id = l.user_id
FROM public.leads l
WHERE o.lead_id = l.id AND o.user_id IS NULL;

UPDATE public.order_items oi
SET user_id = o.user_id
FROM public.orders o
WHERE oi.order_id = o.id AND oi.user_id IS NULL;

-- For products/items/product_items without ownership, assign to admin user
UPDATE public.products SET user_id = (SELECT user_id FROM public.user_roles WHERE role='admin' LIMIT 1) WHERE user_id IS NULL;
UPDATE public.items SET user_id = (SELECT user_id FROM public.user_roles WHERE role='admin' LIMIT 1) WHERE user_id IS NULL;
UPDATE public.product_items SET user_id = (SELECT user_id FROM public.user_roles WHERE role='admin' LIMIT 1) WHERE user_id IS NULL;
UPDATE public.orders SET user_id = (SELECT user_id FROM public.user_roles WHERE role='admin' LIMIT 1) WHERE user_id IS NULL;
UPDATE public.order_items SET user_id = (SELECT user_id FROM public.user_roles WHERE role='admin' LIMIT 1) WHERE user_id IS NULL;

-- ============================================
-- 2. REPLACE PERMISSIVE RLS POLICIES
-- ============================================
DROP POLICY IF EXISTS "Authenticated can manage products" ON public.products;
DROP POLICY IF EXISTS "Authenticated can manage orders" ON public.orders;
DROP POLICY IF EXISTS "Authenticated can manage items" ON public.items;
DROP POLICY IF EXISTS "Authenticated can manage order_items" ON public.order_items;
DROP POLICY IF EXISTS "Authenticated can manage product_items" ON public.product_items;

-- Products
CREATE POLICY "Users manage own products" ON public.products
  FOR ALL TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = user_id OR has_role(auth.uid(), 'admin'));

-- Orders
CREATE POLICY "Users manage own orders" ON public.orders
  FOR ALL TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = user_id OR has_role(auth.uid(), 'admin'));

-- Items
CREATE POLICY "Users manage own items" ON public.items
  FOR ALL TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = user_id OR has_role(auth.uid(), 'admin'));

-- Order items
CREATE POLICY "Users manage own order_items" ON public.order_items
  FOR ALL TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = user_id OR has_role(auth.uid(), 'admin'));

-- Product items
CREATE POLICY "Users manage own product_items" ON public.product_items
  FOR ALL TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = user_id OR has_role(auth.uid(), 'admin'));

-- ============================================
-- 3. RESTRICT chat-media BUCKET
-- ============================================
UPDATE storage.buckets SET public = false WHERE id = 'chat-media';

DROP POLICY IF EXISTS "chat-media public read" ON storage.objects;
DROP POLICY IF EXISTS "chat-media owner read" ON storage.objects;
DROP POLICY IF EXISTS "chat-media owner upload" ON storage.objects;
DROP POLICY IF EXISTS "chat-media owner delete" ON storage.objects;

CREATE POLICY "chat-media owner read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'chat-media' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "chat-media owner upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'chat-media' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "chat-media owner delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'chat-media' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "chat-media service all" ON storage.objects
  FOR ALL TO service_role
  USING (bucket_id = 'chat-media')
  WITH CHECK (bucket_id = 'chat-media');

-- ============================================
-- 4. PERFORMANCE INDEXES (scale)
-- ============================================
CREATE INDEX IF NOT EXISTS idx_chat_messages_lead_created ON public.chat_messages(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_account ON public.chat_messages(account_id);
CREATE INDEX IF NOT EXISTS idx_message_logs_job_status ON public.message_logs(job_id, status);
CREATE INDEX IF NOT EXISTS idx_message_logs_user_created ON public.message_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_events_campaign_type ON public.campaign_events(campaign_id, event_type);
CREATE INDEX IF NOT EXISTS idx_flow_executions_status_next ON public.flow_executions(status, next_action_at) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS idx_leads_user_phone ON public.leads(user_id, phone);
CREATE INDEX IF NOT EXISTS idx_leads_user_status ON public.leads(user_id, chat_status);
CREATE INDEX IF NOT EXISTS idx_broadcast_jobs_user_status ON public.broadcast_jobs(user_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_user_status ON public.orders(user_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_lead ON public.orders(lead_id);
CREATE INDEX IF NOT EXISTS idx_ig_messages_conv_created ON public.instagram_messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ig_conversations_user_last ON public.instagram_conversations(user_id, last_message_at DESC);