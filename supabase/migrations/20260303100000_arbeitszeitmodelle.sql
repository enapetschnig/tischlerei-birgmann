-- Arbeitszeitmodelle für Tischlerei Birgmann
-- Fügt die Wochenstunden-Spalte zur employees-Tabelle hinzu
-- Mögliche Werte: 10 (Geringfügig), 20 (Teilzeit), 32 (Teilzeit Mi frei), 40 (Vollzeit)

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS wochenstunden INTEGER NOT NULL DEFAULT 40
    CHECK (wochenstunden IN (10, 20, 32, 40));
