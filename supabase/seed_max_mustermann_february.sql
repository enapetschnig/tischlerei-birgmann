-- Seed: Regelarbeitszeiten für Max Mustermann - Februar 2026
-- 40h-Modell: Mo-Fr, 8h pro Tag, 06:30-15:30, Pause 12:00-13:00
-- Dieses Script im Supabase SQL Editor ausführen

-- Zuerst Max Mustermann's user_id finden
-- (anpassen falls der Name anders ist)
DO $$
DECLARE
  v_user_id UUID;
  v_project_id UUID;
  v_date DATE;
  v_day_of_week INT;
BEGIN
  -- Max Mustermann finden
  SELECT id INTO v_user_id FROM profiles 
  WHERE vorname = 'Max' AND nachname = 'Mustermann' 
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Max Mustermann nicht gefunden! Bitte prüfen.';
  END IF;

  -- Erstes aktives Projekt nehmen
  SELECT id INTO v_project_id FROM projects 
  WHERE status = 'aktiv' 
  ORDER BY name LIMIT 1;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'Kein aktives Projekt gefunden!';
  END IF;

  -- Bestehende Einträge für Februar löschen (falls vorhanden)
  DELETE FROM time_entries 
  WHERE user_id = v_user_id 
    AND datum >= '2026-02-01' 
    AND datum <= '2026-02-28';

  -- Jeden Arbeitstag im Februar 2026 einfügen
  FOR v_date IN SELECT generate_series('2026-02-01'::date, '2026-02-28'::date, '1 day')::date LOOP
    v_day_of_week := EXTRACT(DOW FROM v_date);
    
    -- Nur Montag (1) bis Freitag (5)
    IF v_day_of_week BETWEEN 1 AND 5 THEN
      INSERT INTO time_entries (
        user_id, 
        project_id, 
        datum, 
        start_time, 
        end_time, 
        pause_start, 
        pause_end, 
        stunden, 
        taetigkeit, 
        ort, 
        notizen
      ) VALUES (
        v_user_id,
        v_project_id,
        v_date,
        '06:30',
        '15:30',
        '12:00',
        '13:00',
        8.0,
        'Tischlerarbeiten',
        'Werkstatt',
        'Regelarbeitszeit'
      );
    END IF;
  END LOOP;

  RAISE NOTICE 'Fertig! Regelarbeitszeiten für Max Mustermann Februar 2026 eingetragen.';
END $$;

-- Ergebnis prüfen:
-- SELECT datum, start_time, end_time, stunden, taetigkeit 
-- FROM time_entries 
-- WHERE user_id = (SELECT id FROM profiles WHERE vorname='Max' AND nachname='Mustermann')
--   AND datum >= '2026-02-01' AND datum <= '2026-02-28'
-- ORDER BY datum;
