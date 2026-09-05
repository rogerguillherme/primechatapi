
-- Add cpf column to leads
ALTER TABLE public.leads ADD COLUMN cpf text;

-- Create index for CPF lookups
CREATE INDEX idx_leads_cpf ON public.leads (cpf) WHERE cpf IS NOT NULL;

-- Add unique constraint on external_order_id to prevent duplicates at DB level
ALTER TABLE public.orders ADD CONSTRAINT orders_external_order_id_unique UNIQUE (external_order_id);
