
-- Flows: cada fluxo de automação
CREATE TABLE public.flows (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.flows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage flows"
  ON public.flows FOR ALL
  USING (true) WITH CHECK (true);

-- Flow steps: cada passo do fluxo
-- step_type: 'message' (envia template/msg), 'delay' (espera X minutos), 'condition' (aguarda clique de botão)
-- trigger_value: para 'condition', o payload/id do botão que dispara este passo
-- template_id: referência ao chat_templates para envio
-- delay_minutes: tempo de espera para step_type='delay'
-- step_order: ordem do passo no fluxo
-- parent_step_id: passo pai (para ramificações de botão)
CREATE TABLE public.flow_steps (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  flow_id UUID NOT NULL REFERENCES public.flows(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL DEFAULT 0,
  step_type TEXT NOT NULL DEFAULT 'message',
  template_id UUID REFERENCES public.chat_templates(id) ON DELETE SET NULL,
  custom_message TEXT,
  delay_minutes INTEGER DEFAULT 0,
  trigger_value TEXT,
  parent_step_id UUID REFERENCES public.flow_steps(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.flow_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage flow_steps"
  ON public.flow_steps FOR ALL
  USING (true) WITH CHECK (true);

-- Flow executions: rastreia em qual passo cada lead está
-- status: 'running', 'waiting_reply', 'waiting_delay', 'completed', 'cancelled'
CREATE TABLE public.flow_executions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  flow_id UUID NOT NULL REFERENCES public.flows(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  current_step_id UUID REFERENCES public.flow_steps(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'running',
  next_action_at TIMESTAMP WITH TIME ZONE,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.flow_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage flow_executions"
  ON public.flow_executions FOR ALL
  USING (true) WITH CHECK (true);

-- Trigger para updated_at nos flows
CREATE TRIGGER update_flows_updated_at
  BEFORE UPDATE ON public.flows
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_flow_executions_updated_at
  BEFORE UPDATE ON public.flow_executions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
