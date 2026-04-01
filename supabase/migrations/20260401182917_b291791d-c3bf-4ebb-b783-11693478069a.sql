
CREATE TABLE public.meta_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  meta_access_token text NOT NULL,
  waba_id text NOT NULL,
  phone_number_id text NOT NULL,
  phone_number text NOT NULL,
  status text NOT NULL DEFAULT 'connected',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.meta_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own meta_connections" ON public.meta_connections
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own meta_connections" ON public.meta_connections
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own meta_connections" ON public.meta_connections
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own meta_connections" ON public.meta_connections
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER update_meta_connections_updated_at
  BEFORE UPDATE ON public.meta_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
