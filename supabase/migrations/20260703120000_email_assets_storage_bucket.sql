/*
  Public Supabase Storage bucket for brand assets used in transactional / campaign emails.
  Objects are world-readable; uploads are service-role only (no public INSERT policy).
*/

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'email-assets',
  'email-assets',
  true,
  1048576,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Email assets public read" ON storage.objects;
CREATE POLICY "Email assets public read"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'email-assets');
