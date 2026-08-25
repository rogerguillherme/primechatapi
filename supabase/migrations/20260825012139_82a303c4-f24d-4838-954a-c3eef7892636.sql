CREATE TABLE public.chat_shortcuts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  command text NOT NULL,
  description text,
  action_type text NOT NULL DEFAULT 'message' CHECK (action_type IN ('message', 'flow')),
  message text,
  flow_id uuid REFERENCES public.flows(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX chat_shortcuts_user_command_unique
  ON public.chat_shortcuts (user_id, lower(command));
CREATE INDEX chat_shortcuts_user_idx ON public.chat_shortcuts (user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_shortcuts TO authenticated;
GRANT ALL ON public.chat_shortcuts TO service_role;

ALTER TABLE public.chat_shortcuts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own chat shortcuts"
  ON public.chat_shortcuts FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_chat_shortcuts_updated_at
  BEFORE UPDATE ON public.chat_shortcuts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();