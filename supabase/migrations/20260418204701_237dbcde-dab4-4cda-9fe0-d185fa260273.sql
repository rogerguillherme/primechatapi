
CREATE TABLE public.instagram_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  ig_user_id text NOT NULL,
  participant_id text NOT NULL,
  participant_username text,
  participant_name text,
  participant_avatar_url text,
  last_message_text text,
  last_message_at timestamptz,
  unread_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ig_user_id, participant_id)
);

CREATE INDEX idx_ig_conv_user ON public.instagram_conversations(user_id, last_message_at DESC);

CREATE TABLE public.instagram_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.instagram_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  ig_message_id text,
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  text text,
  media_url text,
  media_type text,
  status text NOT NULL DEFAULT 'sent',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ig_msg_conv ON public.instagram_messages(conversation_id, created_at);
CREATE UNIQUE INDEX idx_ig_msg_unique ON public.instagram_messages(ig_message_id) WHERE ig_message_id IS NOT NULL;

ALTER TABLE public.instagram_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instagram_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own ig conversations" ON public.instagram_conversations
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Service manages ig conversations" ON public.instagram_conversations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Users manage own ig messages" ON public.instagram_messages
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Service manages ig messages" ON public.instagram_messages
  FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.instagram_conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.instagram_messages;
ALTER TABLE public.instagram_conversations REPLICA IDENTITY FULL;
ALTER TABLE public.instagram_messages REPLICA IDENTITY FULL;
