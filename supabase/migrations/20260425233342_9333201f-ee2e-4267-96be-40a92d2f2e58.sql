-- Tabela para mapear tipo de evento (pix, carrinho, compra, etc) ao agente IA + mídia + copy
CREATE TABLE public.event_agent_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  event_type text NOT NULL,
  agent_id uuid REFERENCES public.ai_agents(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  send_media boolean NOT NULL DEFAULT false,
  media_url text,
  media_type text DEFAULT 'image',
  message_template text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_type)
);

ALTER TABLE public.event_agent_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own event_agent_config"
ON public.event_agent_config
FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service can manage event_agent_config"
ON public.event_agent_config
FOR ALL TO service_role
USING (true) WITH CHECK (true);

CREATE TRIGGER event_agent_config_updated_at
BEFORE UPDATE ON public.event_agent_config
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_event_agent_config_user_event ON public.event_agent_config(user_id, event_type);