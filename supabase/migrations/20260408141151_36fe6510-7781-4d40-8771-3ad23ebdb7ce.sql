
ALTER TABLE public.meta_connections ALTER COLUMN phone_number_id DROP NOT NULL;
ALTER TABLE public.meta_connections ALTER COLUMN phone_number DROP NOT NULL;
ALTER TABLE public.meta_connections ALTER COLUMN waba_id DROP NOT NULL;
ALTER TABLE public.meta_connections ALTER COLUMN phone_number_id SET DEFAULT '';
ALTER TABLE public.meta_connections ALTER COLUMN phone_number SET DEFAULT '';
ALTER TABLE public.meta_connections ALTER COLUMN waba_id SET DEFAULT '';
