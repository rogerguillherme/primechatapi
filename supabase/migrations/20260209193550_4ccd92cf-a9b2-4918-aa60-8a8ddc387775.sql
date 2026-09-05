
-- Add sequential code column to leads
ALTER TABLE public.leads ADD COLUMN code SERIAL;

-- Create unique index on code
CREATE UNIQUE INDEX idx_leads_code ON public.leads(code);

-- Normalize existing phones: prepend 55 if not already starting with 55
UPDATE public.leads 
SET phone = '55' || phone 
WHERE phone NOT LIKE '55%';
