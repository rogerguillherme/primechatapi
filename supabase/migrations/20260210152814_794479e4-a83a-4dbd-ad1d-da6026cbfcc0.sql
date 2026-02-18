
-- Table to store chat messages (bidirectional WhatsApp via ZAPI)
CREATE TABLE public.chat_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  content TEXT NOT NULL,
  media_url TEXT,
  media_type TEXT,
  zapi_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'read', 'failed', 'received')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Table for message templates
CREATE TABLE public.chat_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT DEFAULT 'geral',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_templates ENABLE ROW LEVEL SECURITY;

-- Policies (same pattern as existing tables - restrictive ALL with true)
CREATE POLICY "Authenticated users can manage chat_messages"
  ON public.chat_messages FOR ALL
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can manage chat_templates"
  ON public.chat_templates FOR ALL
  USING (true) WITH CHECK (true);

-- Indexes for performance
CREATE INDEX idx_chat_messages_lead_id ON public.chat_messages(lead_id);
CREATE INDEX idx_chat_messages_created_at ON public.chat_messages(created_at DESC);

-- Enable realtime for chat messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;

-- Trigger for updated_at on templates
CREATE TRIGGER update_chat_templates_updated_at
  BEFORE UPDATE ON public.chat_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
