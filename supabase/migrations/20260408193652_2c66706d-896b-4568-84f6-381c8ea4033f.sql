
-- Items: restringir para authenticated apenas
DROP POLICY IF EXISTS "Authenticated users can manage items" ON public.items;
CREATE POLICY "Authenticated can manage items" ON public.items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Products: restringir para authenticated apenas  
DROP POLICY IF EXISTS "Authenticated users can manage products" ON public.products;
CREATE POLICY "Authenticated can manage products" ON public.products
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Orders: restringir para authenticated apenas
DROP POLICY IF EXISTS "Authenticated users can manage orders" ON public.orders;
CREATE POLICY "Authenticated can manage orders" ON public.orders
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Service can manage all orders" ON public.orders
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Order Items: restringir para authenticated apenas
DROP POLICY IF EXISTS "Authenticated users can manage order_items" ON public.order_items;
CREATE POLICY "Authenticated can manage order_items" ON public.order_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Product Items: restringir para authenticated apenas
DROP POLICY IF EXISTS "Authenticated users can manage product_items" ON public.product_items;
CREATE POLICY "Authenticated can manage product_items" ON public.product_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
