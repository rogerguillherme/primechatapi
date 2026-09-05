ALTER TABLE public.webhook_endpoints
ADD COLUMN IF NOT EXISTS field_mapping jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.webhook_endpoints.field_mapping IS 'Maps external webhook payload paths to internal lead/order fields, e.g. {"name":"nome","phone":"phone"}.';