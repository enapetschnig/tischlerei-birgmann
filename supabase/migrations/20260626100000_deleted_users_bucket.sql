-- Storage Bucket für Excel-Backups gelöschter Mitarbeiter (nur Admins)
-- Vorher schrieb der Mitarbeiter-Löschen-Flow in diesen nicht existierenden Bucket -> Cloud-Backup schlug still fehl.
INSERT INTO storage.buckets (id, name, public)
VALUES ('deleted-users', 'deleted-users', false)
ON CONFLICT (id) DO NOTHING;

-- SELECT: Nur Admins können Backups sehen
CREATE POLICY "Admins can view deleted-users backups"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'deleted-users'
  AND public.has_role(auth.uid(), 'administrator'::app_role)
);

-- INSERT: Nur Admins können Backups hochladen
CREATE POLICY "Admins can upload deleted-users backups"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'deleted-users'
  AND public.has_role(auth.uid(), 'administrator'::app_role)
);

-- DELETE: Nur Admins können Backups löschen
CREATE POLICY "Admins can delete deleted-users backups"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'deleted-users'
  AND public.has_role(auth.uid(), 'administrator'::app_role)
);
