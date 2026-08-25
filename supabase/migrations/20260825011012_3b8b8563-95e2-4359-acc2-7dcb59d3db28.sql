CREATE TABLE public.share_links (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  name text NOT NULL,
  account_id uuid REFERENCES public.whatsapp_accounts(id) ON DELETE SET NULL,
  phone text NOT NULL,
  message text NOT NULL DEFAULT '',
  label_id uuid REFERENCES public.chat_labels(id) ON DELETE SET NULL,
  stage_id uuid REFERENCES public.pipeline_stages(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  click_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_share_links_user ON public.share_links(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.share_links TO authenticated;
GRANT ALL ON public.share_links TO service_role;

ALTER TABLE public.share_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own share links"
ON public.share_links FOR ALL TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_share_links_updated_at
BEFORE UPDATE ON public.share_links
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();