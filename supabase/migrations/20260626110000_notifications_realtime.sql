-- Benachrichtigungen live aktualisieren: notifications-Tabelle zur Realtime-Publication hinzufügen.
-- Vorher war die Glocke (NotificationBell) auf postgres_changes abonniert, aber die Tabelle war nicht
-- Teil von supabase_realtime -> neue Benachrichtigungen kamen erst nach einem Reload.

-- REPLICA IDENTITY FULL, damit der user_id-Filter im Subscription zuverlässig matcht
ALTER TABLE public.notifications REPLICA IDENTITY FULL;

-- Idempotent zur Publication hinzufügen
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;
