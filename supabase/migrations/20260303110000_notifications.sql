-- Benachrichtigungen-Tabelle für Tischlerei Birgmann
-- Wird für In-App Notifications (Urlaubsanträge, Lohnzettel, Krankmeldungen) verwendet

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,        -- 'leave_request' | 'leave_approved' | 'leave_rejected' | 'krankmeldung' | 'lohnzettel'
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  related_id UUID,           -- optionale Referenz z.B. auf leave_request.id
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS aktivieren
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Jeder sieht nur eigene Benachrichtigungen
CREATE POLICY "Users see own notifications"
  ON public.notifications
  FOR SELECT
  USING (auth.uid() = user_id);

-- Jeder eingeloggte User darf Benachrichtigungen erstellen (für Client-side Triggers)
CREATE POLICY "Authenticated users can insert notifications"
  ON public.notifications
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Benutzer können eigene Benachrichtigungen als gelesen markieren
CREATE POLICY "Users can update own notifications"
  ON public.notifications
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Index für Performance
CREATE INDEX IF NOT EXISTS notifications_user_id_read_idx
  ON public.notifications(user_id, read);

CREATE INDEX IF NOT EXISTS notifications_created_at_idx
  ON public.notifications(created_at DESC);
