
-- Add meta_status column to track template approval status from Meta
ALTER TABLE public.chat_templates 
ADD COLUMN IF NOT EXISTS meta_status text DEFAULT 'unknown';

-- Add comment for clarity
COMMENT ON COLUMN public.chat_templates.meta_status IS 'Template status from Meta: APPROVED, PENDING, REJECTED, PAUSED, DISABLED, unknown';
