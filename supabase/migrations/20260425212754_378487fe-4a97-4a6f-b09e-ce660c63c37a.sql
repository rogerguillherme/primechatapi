
ALTER TABLE public.flow_steps ADD COLUMN IF NOT EXISTS media_url text;
ALTER TABLE public.flow_steps ADD COLUMN IF NOT EXISTS media_type text;

UPDATE storage.buckets SET public = true WHERE id = 'chat-media';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Public read chat-media') THEN
    CREATE POLICY "Public read chat-media" ON storage.objects FOR SELECT USING (bucket_id = 'chat-media');
  END IF;
END $$;
