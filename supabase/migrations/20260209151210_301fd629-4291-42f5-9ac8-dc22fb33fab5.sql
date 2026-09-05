
-- Leads (compradores)
CREATE TABLE public.leads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT NOT NULL UNIQUE,
  origin TEXT DEFAULT 'hubla',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Products (pacotes do checkout)
CREATE TABLE public.products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  checkout_name TEXT NOT NULL UNIQUE,
  sku TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Items (itens físicos)
CREATE TABLE public.items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('kit', 'suplemento')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Product_Items (composição do pacote)
CREATE TABLE public.product_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1,
  UNIQUE(product_id, item_id)
);

-- Orders (pedidos)
CREATE TABLE public.orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id),
  external_order_id TEXT NOT NULL UNIQUE,
  amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  payment_method TEXT,
  webhook_payload JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Order_Items (itens gerados automaticamente)
CREATE TABLE public.order_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1
);

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_leads_updated_at BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Indexes
CREATE INDEX idx_leads_phone ON public.leads(phone);
CREATE INDEX idx_orders_lead_id ON public.orders(lead_id);
CREATE INDEX idx_orders_external_id ON public.orders(external_order_id);
CREATE INDEX idx_orders_status ON public.orders(status);
CREATE INDEX idx_product_items_product ON public.product_items(product_id);

-- RLS (public access for now since this is an admin CRM, auth will be added later)
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

-- Allow all operations for authenticated users
CREATE POLICY "Authenticated users can manage leads" ON public.leads FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage products" ON public.products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage items" ON public.items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage product_items" ON public.product_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage orders" ON public.orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage order_items" ON public.order_items FOR ALL USING (true) WITH CHECK (true);

-- Seed initial products
INSERT INTO public.items (name, type) VALUES
  ('Kit Menopausa Cancelada', 'kit'),
  ('Ômega 3', 'suplemento'),
  ('Multivitamínico', 'suplemento'),
  ('Vitamina D', 'suplemento'),
  ('Magnésio', 'suplemento');

INSERT INTO public.products (checkout_name, sku) VALUES
  ('Menopausa Cancelada', 'MC-BASE'),
  ('Menopausa Cancelada +1 Kit', 'MC-1KIT'),
  ('Menopausa Cancelada +2 Kits', 'MC-2KITS'),
  ('Menopausa Cancelada + Suplementação Completa', 'MC-SUPL');

-- Compose products with items
WITH 
  p_base AS (SELECT id FROM public.products WHERE sku = 'MC-BASE'),
  p_1kit AS (SELECT id FROM public.products WHERE sku = 'MC-1KIT'),
  p_2kits AS (SELECT id FROM public.products WHERE sku = 'MC-2KITS'),
  p_supl AS (SELECT id FROM public.products WHERE sku = 'MC-SUPL'),
  i_kit AS (SELECT id FROM public.items WHERE name = 'Kit Menopausa Cancelada'),
  i_omega AS (SELECT id FROM public.items WHERE name = 'Ômega 3'),
  i_multi AS (SELECT id FROM public.items WHERE name = 'Multivitamínico'),
  i_vitd AS (SELECT id FROM public.items WHERE name = 'Vitamina D'),
  i_mag AS (SELECT id FROM public.items WHERE name = 'Magnésio')
INSERT INTO public.product_items (product_id, item_id, quantity) VALUES
  ((SELECT id FROM p_base), (SELECT id FROM i_kit), 1),
  ((SELECT id FROM p_1kit), (SELECT id FROM i_kit), 2),
  ((SELECT id FROM p_2kits), (SELECT id FROM i_kit), 3),
  ((SELECT id FROM p_supl), (SELECT id FROM i_kit), 1),
  ((SELECT id FROM p_supl), (SELECT id FROM i_omega), 1),
  ((SELECT id FROM p_supl), (SELECT id FROM i_multi), 1),
  ((SELECT id FROM p_supl), (SELECT id FROM i_vitd), 1),
  ((SELECT id FROM p_supl), (SELECT id FROM i_mag), 1);
