ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS antiban_show_quality boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS antiban_warn_medium boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS antiban_confirm_low boolean NOT NULL DEFAULT true;