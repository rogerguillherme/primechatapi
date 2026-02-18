
-- Add WhatsApp Cloud API template fields to chat_templates
ALTER TABLE public.chat_templates
ADD COLUMN IF NOT EXISTS template_name text,
ADD COLUMN IF NOT EXISTS template_language text DEFAULT 'pt_BR',
ADD COLUMN IF NOT EXISTS template_params jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.chat_templates.template_name IS 'Nome do template aprovado na Meta (ex: hello_customer)';
COMMENT ON COLUMN public.chat_templates.template_language IS 'Código do idioma do template (ex: pt_BR)';
COMMENT ON COLUMN public.chat_templates.template_params IS 'Array de parâmetros do template [{type: "text", text: "valor"}]';
