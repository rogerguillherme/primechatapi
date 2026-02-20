
-- Junction table: many-to-many between whatsapp_accounts and chat_templates
CREATE TABLE public.account_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES public.whatsapp_accounts(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES public.chat_templates(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(account_id, template_id)
);

ALTER TABLE public.account_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage account_templates"
ON public.account_templates FOR ALL
USING (true)
WITH CHECK (true);
