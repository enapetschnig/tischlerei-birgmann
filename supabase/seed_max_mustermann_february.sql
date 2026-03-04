-- Stundeneintraege fuer Max Mustermann im Februar 2026
-- UUID: f4556eed-6e68-4840-b1f2-e773f792680f
-- 40h/Woche = 8h/Tag, Mo-Fr, keine Feiertage im Feb

DO $$
DECLARE
  v_user_id UUID := 'f4556eed-6e68-4840-b1f2-e773f792680f';
  v_project_id UUID;
BEGIN
  SELECT id INTO v_project_id FROM projects WHERE status = 'aktiv' LIMIT 1;
  IF v_project_id IS NULL THEN
    RAISE NOTICE 'Kein aktives Projekt gefunden!';
    RETURN;
  END IF;

  DELETE FROM time_entries
  WHERE user_id = v_user_id AND datum >= '2026-02-01' AND datum <= '2026-02-28';

  INSERT INTO time_entries (user_id, datum, start_time, end_time, stunden, pause_minutes, project_id, taetigkeit, location_type) VALUES
  (v_user_id, '2026-02-02', '07:00', '16:00', 8, 60, v_project_id, 'Montage', 'baustelle'),
  (v_user_id, '2026-02-03', '07:00', '16:00', 8, 60, v_project_id, 'Montage', 'baustelle'),
  (v_user_id, '2026-02-04', '07:00', '16:00', 8, 60, v_project_id, 'Werkstatt', 'werkstatt'),
  (v_user_id, '2026-02-05', '07:00', '16:00', 8, 60, v_project_id, 'Montage', 'baustelle'),
  (v_user_id, '2026-02-06', '07:00', '16:00', 8, 60, v_project_id, 'Montage', 'baustelle'),
  (v_user_id, '2026-02-09', '07:00', '16:00', 8, 60, v_project_id, 'Montage', 'baustelle'),
  (v_user_id, '2026-02-10', '07:00', '16:00', 8, 60, v_project_id, 'Werkstatt', 'werkstatt'),
  (v_user_id, '2026-02-11', '07:00', '16:00', 8, 60, v_project_id, 'Montage', 'baustelle'),
  (v_user_id, '2026-02-12', '07:00', '16:00', 8, 60, v_project_id, 'Montage', 'baustelle'),
  (v_user_id, '2026-02-13', '07:00', '16:00', 8, 60, v_project_id, 'Montage', 'baustelle'),
  (v_user_id, '2026-02-16', '07:00', '16:00', 8, 60, v_project_id, 'Montage', 'baustelle'),
  (v_user_id, '2026-02-17', '07:00', '16:00', 8, 60, v_project_id, 'Montage', 'baustelle'),
  (v_user_id, '2026-02-18', '07:00', '16:00', 8, 60, v_project_id, 'Werkstatt', 'werkstatt'),
  (v_user_id, '2026-02-19', '07:00', '16:00', 8, 60, v_project_id, 'Montage', 'baustelle'),
  (v_user_id, '2026-02-20', '07:00', '16:00', 8, 60, v_project_id, 'Montage', 'baustelle'),
  (v_user_id, '2026-02-23', '07:00', '16:00', 8, 60, v_project_id, 'Montage', 'baustelle'),
  (v_user_id, '2026-02-24', '07:00', '16:00', 8, 60, v_project_id, 'Montage', 'baustelle'),
  (v_user_id, '2026-02-25', '07:00', '16:00', 8, 60, v_project_id, 'Werkstatt', 'werkstatt'),
  (v_user_id, '2026-02-26', '07:00', '16:00', 8, 60, v_project_id, 'Montage', 'baustelle'),
  (v_user_id, '2026-02-27', '07:00', '16:00', 8, 60, v_project_id, 'Montage', 'baustelle');

  RAISE NOTICE '20 Arbeitstage fuer Max Mustermann im Februar 2026 eingetragen (Projekt: %)', v_project_id;
END $$;
