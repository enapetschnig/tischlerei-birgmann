-- Admin kann alle Zeiteinträge bearbeiten (UPDATE)
CREATE POLICY "Admins can update all time entries"
  ON public.time_entries FOR UPDATE
  USING (public.has_role(auth.uid(), 'administrator'));

-- Admin kann alle Zeiteinträge löschen (DELETE)
CREATE POLICY "Admins can delete all time entries"
  ON public.time_entries FOR DELETE
  USING (public.has_role(auth.uid(), 'administrator'));
