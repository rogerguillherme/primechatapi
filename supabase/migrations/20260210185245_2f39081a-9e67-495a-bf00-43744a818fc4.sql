-- Create storage bucket for chat media
INSERT INTO storage.buckets (id, name, public) VALUES ('chat-media', 'chat-media', true);

-- Allow anyone to view chat media (public bucket)
CREATE POLICY "Chat media is publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'chat-media');

-- Allow authenticated and anon users to upload chat media
CREATE POLICY "Anyone can upload chat media"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'chat-media');

-- Allow deletion of chat media
CREATE POLICY "Anyone can delete chat media"
ON storage.objects FOR DELETE
USING (bucket_id = 'chat-media');