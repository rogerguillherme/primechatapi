
-- Chat labels (etiquetas de atendimento)
CREATE TABLE public.chat_labels (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  user_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_labels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage chat_labels"
  ON public.chat_labels FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Lead-label junction
CREATE TABLE public.lead_labels (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  label_id UUID NOT NULL REFERENCES public.chat_labels(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(lead_id, label_id)
);

ALTER TABLE public.lead_labels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage lead_labels"
  ON public.lead_labels FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Add assigned_to and timestamp tracking to leads
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS assigned_to UUID DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_outbound_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- Update trigger to also track last_inbound_at and last_outbound_at
CREATE OR REPLACE FUNCTION public.update_lead_chat_status_on_message()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.direction = 'inbound' THEN
    UPDATE public.leads 
    SET chat_status = 'aguardando_respostas', 
        updated_at = now(),
        last_inbound_at = now()
    WHERE id = NEW.lead_id;
  ELSIF NEW.direction = 'outbound' THEN
    UPDATE public.leads 
    SET chat_status = 'respondidas', 
        updated_at = now(),
        last_outbound_at = now()
    WHERE id = NEW.lead_id;
  END IF;
  RETURN NEW;
END;
$$;

-- Enable realtime for lead_labels
ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_labels;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_labels;
