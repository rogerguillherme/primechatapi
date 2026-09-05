
-- Add chat_status column to leads
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS chat_status text NOT NULL DEFAULT 'novos_pedidos';

-- Create index for fast filtering
CREATE INDEX IF NOT EXISTS idx_leads_chat_status ON public.leads (chat_status);

-- Trigger: when inbound message arrives, set lead to 'aguardando_respostas'
-- When outbound message is sent, set lead to 'respondidas'
CREATE OR REPLACE FUNCTION public.update_lead_chat_status_on_message()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.direction = 'inbound' THEN
    UPDATE public.leads SET chat_status = 'aguardando_respostas', updated_at = now() WHERE id = NEW.lead_id;
  ELSIF NEW.direction = 'outbound' THEN
    UPDATE public.leads SET chat_status = 'respondidas', updated_at = now() WHERE id = NEW.lead_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_update_lead_chat_status
AFTER INSERT ON public.chat_messages
FOR EACH ROW
EXECUTE FUNCTION public.update_lead_chat_status_on_message();

-- Set existing leads with messages to appropriate status based on last message
UPDATE public.leads l SET chat_status = 
  CASE 
    WHEN (SELECT direction FROM public.chat_messages WHERE lead_id = l.id ORDER BY created_at DESC LIMIT 1) = 'inbound' THEN 'aguardando_respostas'
    WHEN (SELECT direction FROM public.chat_messages WHERE lead_id = l.id ORDER BY created_at DESC LIMIT 1) = 'outbound' THEN 'respondidas'
    ELSE 'novos_pedidos'
  END;

-- Set leads with refund orders to 'reembolso'
UPDATE public.leads l SET chat_status = 'reembolso'
WHERE EXISTS (SELECT 1 FROM public.orders o WHERE o.lead_id = l.id AND o.status = 'refunded');
