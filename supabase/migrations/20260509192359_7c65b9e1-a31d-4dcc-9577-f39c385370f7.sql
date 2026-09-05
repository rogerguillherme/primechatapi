ALTER TABLE public.instagram_connections
  ADD COLUMN IF NOT EXISTS user_access_token text,
  ADD COLUMN IF NOT EXISTS user_token_expires_at timestamptz;