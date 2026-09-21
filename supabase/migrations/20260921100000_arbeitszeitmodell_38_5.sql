-- Änderungswunsch Petra Birgmann (21.09.2026): "Habe verschiedene Arbeiter
-- mit unterschiedlichen Regelarbeitszeiten, 38,5 bitte hinzufügen."
--
-- Wochenstunden waren ganzzahlig (10/20/32/40). Für 38,5 wird die Spalte auf
-- double precision umgestellt (PostgREST liefert das als JSON-Zahl, kein
-- String-Parsing im Client nötig). Die Regelarbeitszeiten werden ab jetzt je
-- Modell gespeichert (app_settings 'regelarbeitszeiten': {"40":{...},"38.5":{...},"32":{...}});
-- das alte flache Format liest die App weiterhin und wandelt es beim ersten
-- Speichern um.

ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_wochenstunden_check;

ALTER TABLE public.employees
  ALTER COLUMN wochenstunden TYPE double precision USING wochenstunden::double precision,
  ALTER COLUMN wochenstunden SET DEFAULT 40;

ALTER TABLE public.employees
  ADD CONSTRAINT employees_wochenstunden_check
  CHECK (wochenstunden IN (10, 20, 32, 38.5, 40));

NOTIFY pgrst, 'reload schema';
