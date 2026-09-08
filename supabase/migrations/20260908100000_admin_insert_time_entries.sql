-- Änderungswunsch Petra Birgmann (07.09.2026): "Ich als Admin möchte den
-- Urlaub eintragen können von den Mitarbeitern."
--
-- Bisher durften Admins fremde Zeiteinträge nur lesen, ändern und löschen —
-- aber nicht ANLEGEN (INSERT nur mit auth.uid() = user_id). Damit konnte ein
-- Admin weder Urlaub für einen Mitarbeiter eintragen noch im
-- Admin-Bearbeitungsmodus der Zeiterfassung eine Abwesenheit für ihn buchen.

DROP POLICY IF EXISTS "Admins can insert time entries for anyone" ON public.time_entries;
CREATE POLICY "Admins can insert time entries for anyone"
  ON public.time_entries FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'administrator'::app_role));
