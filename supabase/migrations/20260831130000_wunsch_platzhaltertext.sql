-- Fix 31.08.2026: Reine Sprachnachrichten kamen nie im CRM an.
--
-- Der Eingang des CRM verlangt `id` UND `text` und antwortet sonst mit
-- 400 "id und text nötig". Bei einer reinen Sprachnachricht ist `text` beim
-- Anlegen aber leer — die Abschrift trägt ihn erst nach. Die Meldung wurde
-- deshalb verworfen, und wenn die Abschrift scheitert (oder kein
-- OPENAI_API_KEY gesetzt ist), fehlte sie im CRM für immer.
--
-- Lösung: Ist der Text leer, schickt der Trigger einen Platzhalter. Die
-- Meldung erscheint dadurch sofort im CRM; sobald die Abschrift eintrifft,
-- feuert der Trigger erneut (UPDATE OF text) und ersetzt den Platzhalter
-- durch den echten Wortlaut.

CREATE OR REPLACE FUNCTION public.wunsch_ans_cockpit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v public.cockpit_verbindung%ROWTYPE;
  melder text;
  inhalt text;
BEGIN
  SELECT * INTO v FROM public.cockpit_verbindung LIMIT 1;
  IF v IS NULL THEN
    RETURN NEW;                     -- Verbindung nicht eingerichtet: still
  END IF;

  SELECT NULLIF(TRIM(CONCAT(p.vorname, ' ', p.nachname)), '')
    INTO melder FROM public.profiles p WHERE p.id = NEW.erstellt_von;

  -- Das CRM verlangt einen nicht-leeren Text. Bei reiner Sprachnachricht
  -- steht hier zunächst ein Platzhalter.
  inhalt := NULLIF(TRIM(COALESCE(NEW.text, '')), '');
  IF inhalt IS NULL THEN
    IF NEW.audio_pfad IS NOT NULL THEN
      inhalt := CASE NEW.abschrift
                  WHEN 'fehler' THEN '[Sprachnachricht — Abschrift fehlgeschlagen, bitte anhören]'
                  ELSE '[Sprachnachricht — Abschrift läuft noch]'
                END;
    ELSE
      inhalt := '[Ohne Text gemeldet — bitte Bildschirmfoto ansehen]';
    END IF;
  END IF;

  PERFORM net.http_post(
    url := v.url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-app-key', v.app_key,
      'x-cockpit-secret', v.secret
    ),
    body := jsonb_build_object(
      'id',              NEW.id,
      'art',             NEW.art,
      'status',          NEW.status,
      'text',            inhalt,
      'antwort',         NEW.antwort,
      'seite',           NEW.seite,
      'bild_pfad',       NEW.bild_pfad,
      'audio_pfad',      NEW.audio_pfad,
      'melder',          COALESCE(melder, ''),
      'erstellt_am',     NEW.created_at,
      'aktualisiert_am', NEW.updated_at
    )
  );
  RETURN NEW;
END;
$$;

-- Auch auf `abschrift` reagieren: schlägt die Spracherkennung fehl, soll der
-- Platzhalter im CRM von "läuft noch" auf "fehlgeschlagen" wechseln.
DROP TRIGGER IF EXISTS trg_wunsch_cockpit ON public.aenderungswuensche;
CREATE TRIGGER trg_wunsch_cockpit
  AFTER INSERT OR UPDATE OF status, antwort, text, bild_pfad, audio_pfad, abschrift
  ON public.aenderungswuensche
  FOR EACH ROW EXECUTE FUNCTION public.wunsch_ans_cockpit();
