CREATE TABLE IF NOT EXISTS public.chat_stickers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  url text NOT NULL,
  label text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_stickers_user_idx ON public.chat_stickers(user_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_stickers TO authenticated;
GRANT ALL ON public.chat_stickers TO service_role;
ALTER TABLE public.chat_stickers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own stickers select" ON public.chat_stickers;
CREATE POLICY "own stickers select" ON public.chat_stickers FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "own stickers insert" ON public.chat_stickers;
CREATE POLICY "own stickers insert" ON public.chat_stickers FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "own stickers delete" ON public.chat_stickers;
CREATE POLICY "own stickers delete" ON public.chat_stickers FOR DELETE TO authenticated USING (auth.uid() = user_id);