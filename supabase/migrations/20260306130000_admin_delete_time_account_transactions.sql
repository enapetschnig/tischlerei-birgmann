-- Admin kann Zeitkonto-Transaktionen löschen (für Monatsabschluss aufheben)
CREATE POLICY "Admins can delete transactions"
  ON public.time_account_transactions FOR DELETE
  USING (public.has_role(auth.uid(), 'administrator'));
