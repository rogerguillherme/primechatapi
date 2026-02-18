
-- Create app_settings table for storing app configurations
CREATE TABLE public.app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Allow all access (no auth in this app)
CREATE POLICY "Allow all access to app_settings"
ON public.app_settings
FOR ALL
USING (true)
WITH CHECK (true);

-- Insert default verify token
INSERT INTO public.app_settings (key, value) VALUES ('whatsapp_verify_token', '') ON CONFLICT DO NOTHING;
