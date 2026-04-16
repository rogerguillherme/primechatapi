
-- Table for Instagram automation flows
CREATE TABLE public.instagram_automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  trigger_type text NOT NULL DEFAULT 'comment_keyword',
  keywords text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.instagram_automations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own instagram_automations"
  ON public.instagram_automations FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service can manage all instagram_automations"
  ON public.instagram_automations FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Table for steps within an automation
CREATE TABLE public.instagram_automation_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id uuid NOT NULL REFERENCES public.instagram_automations(id) ON DELETE CASCADE,
  step_order integer NOT NULL DEFAULT 0,
  step_type text NOT NULL DEFAULT 'reply_comment',
  message text DEFAULT '',
  delay_seconds integer DEFAULT 5,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.instagram_automation_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own automation steps"
  ON public.instagram_automation_steps FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.instagram_automations a WHERE a.id = instagram_automation_steps.automation_id AND a.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.instagram_automations a WHERE a.id = instagram_automation_steps.automation_id AND a.user_id = auth.uid()));

CREATE POLICY "Service can manage all automation steps"
  ON public.instagram_automation_steps FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
