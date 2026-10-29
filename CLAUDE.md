# Tischlerei Birgmann – Kundenakte (Zeiterfassungs- und Betriebs-App)

## Wer ist der Kunde
- **Franz Birgmann Tischlereigesellschaft m.b.H.**, 5142 Eggelsberg (Oberösterreich). Tischlerei mit Werkstatt und
  Montage.
- Ansprechpartner: **Franz Birgmann** (Inhaber laut CRM), **Petra Birgmann** (Admin in der App, meldet alle
  Änderungswünsche über den Melde-Knopf, schreibt in der „wir“-Form und schickt auch Mails an Christoph). 9 Mitarbeiter (Stand 24.09.2026).
- App live seit März 2026 (aus der „Handwerksapp Vorlage“ bzw. Möbel-Eder-Vorlage geklont, 03.03.2026 auf Birgmann
  umgebaut).
- Funktionen: Zeiterfassung (Werkstatt/Projekte), Regiebericht (`Disturbances`, mit Unterschrift + E-Mail),
  Disponierung/Ressourcenplanung, Urlaub/Abwesenheit, Zeitkonto (ZA), Stundenauswertung + Excel, Projekte mit
  Dateien, Materiallisten, Rechnungen/Angebote, Lohnzettel/Dokumente, Benachrichtigungen, Melde-Knopf.

### Rollen (`app_role`)
| Rolle | Wer |
|---|---|
| `administrator` | Petra/Büro – Admin-Bereich, Mitarbeiter, Regelarbeitszeiten, Urlaubsverwaltung, Stundenauswertung |
| `mitarbeiter` | Tischler – Zeiterfassung, Regiebericht, eigene Stunden/Dokumente |

## Fachbegriffe
- **Regelarbeitszeit** je Arbeitszeitmodell und Wochentag (Beginn/Ende, Pause Vormittag + Pause Mittag als Minuten).
- **Arbeitszeitmodell** (Wochenstunden): 40, 38,5, 32 (mit Plan) und 20, 10 (flexibel) – `src/lib/workingHours.ts`
  (`ALL_MODELS`, `getWorkModelLabel`). 38,5 h seit 21.09.2026 (Freitag kürzer).
- **Komm** = Kommission (Projekt), z. B. „Komm Maier“; **Unterordner** = Arbeitsschritt im Projekt (z. B. „Zuschneiden“).
- **ZA** = Zeitausgleich (früher „ZDA“), Monatsabschluss (aufhebbar), Zeitkonto.
- **Regiebericht** = Bericht mit Unterschrift für den Kunden (Route `/disturbances`).
- **Disponierung** = Einteilung der Mitarbeiter auf Projekte (Startseite zeigt sie live).

## Kundenwünsche und Entscheidungen
- **23.08.2026 (Mail Petra)**: „wir als Admin möchten selbst die Regel Arbeitszeiten eistellen können“; Pause Vormittag
  und Pause Mittag „mit einem minütigen Zeitrad … (nicht von bis)“; Projektzeiten mit Stunden- und 0/15/30/45-Rad
  verteilen („3:15 Std. Komm Maier + 3:45 Std. Komm Bauer + Restzeit Komm Weindl“); Werkstatt-Einträge brauchen
  Projekte; Unterordner je Projekt – „so einfach wie möglich“. Umgesetzt b4a90f8; Christoph: „unterordner sollen im
  projekt ja auch angelegt werden“ → zusätzlich am Projekt (3672e91).
- **07.09.**: „Ich als Admin möchte den Urlaub eintragen können von den Mitarbeitern“ → Urlaubsverwaltung → „Abwesenheit
  eintragen“ (`AdminAbsenceEntry.tsx`): Wochenenden, modellfreie Tage und belegte Tage werden übersprungen, Stunden aus
  der Regelarbeitszeit, Mitarbeiter wird benachrichtigt. Neue INSERT-Policy für Admins auf `time_entries`.
- **16.09.**: Mitarbeiter-Handy meldete „App zu alt“ → kommt vom Handy, nicht von der App (PWA über den Browser): auf
  Android Google Chrome aus dem Play Store installieren, dann birgmann.app öffnen (Christoph: Lösung „nur für android“).
- **21./24.09.**: 38,5 Std. – Mitarbeiter werden im **Admin-Bereich → Mitarbeiter → Bearbeiten → Arbeitszeitmodell**
  bearbeitet. Die Seite `/employees` (`src/pages/Employees.tsx`) ist **tot** (nirgends verlinkt) – Änderungen nie dort,
  sondern in `src/pages/Admin.tsx` einbauen. Entfernen der Seite ist noch nicht freigegeben. Wochenstunden als
  Kommazahl lesen (`parseFloat`, nicht `parseInt`). Details: `JOURNAL.md` (24.09.).

## Feste Regeln und No-Gos
- Antworten an Petra kurz, freundlich, immer mit dem Weg in der App („Admin-Bereich → …“), gleiche Anrede wie sie.
- Neue Regeln für Arbeitszeiten über die gemeinsamen Helfer in `src/lib/workingHours.ts`, nicht pro Seite eigene Listen.
- Nach jedem Deploy: Nutzer müssen die PWA einmal neu laden (Service Worker liefert sonst das alte Bundle).
- Tokens aus dem Chat nie speichern oder ins Repo schreiben; zum Rotieren raten.
- Nur im Ordner `~/Developer/tischlerei_birgmann` arbeiten (es gab eine tote Altkopie unter
  `~/Documents/Kunden-Apps/` auf dem Mac – die `.vercel`-Verknüpfung dort sagt nichts darüber, was live ist).

## Technik
- **Supabase** `irfhbetcnxhuvoxgjeym` (`supabase/config.toml` enthält nur den Platzhalter „DEIN-PROJEKT-ID“ – immer
  `--project-ref irfhbetcnxhuvoxgjeym` mitgeben). Zugriff per Management-API mit `SUPABASE_ACCESS_TOKEN` aus
  `~/.config/hw/zugangsdaten.env` (nie ausgeben).
- **Live**: https://birgmann.app (www.birgmann.app, tischlerei-birgmann.vercel.app). GitHub
  `enapetschnig/tischlerei-birgmann`, Vercel deployt `main` über die GitHub-Integration (Bundle wechselt nach 30–120 s).
- **Edge Functions** werden NICHT mit dem Push deployt:
  `supabase functions deploy <name> --project-ref irfhbetcnxhuvoxgjeym` (Docker-Warnung ist harmlos). Funktionen:
  `generate-invoice-pdf` (Rechnung/Angebot als HTML, Client druckt), `send-disturbance-report` (Regiebericht – jsPDF per dynamischem Import,
  holt das Logo von `https://www.birgmann.app/birgmann-logo.png`), `send-invitation` (SMS), `create-team-time-entries`,
  `migrate-sick-notes`, `sprache-zu-text` (Whisper), `wunsch-datei` (verify_jwt=false, nur mit Geheimnis).
- **Gates vor Commit**: `npx tsc --noEmit` (der Build `vite build` prüft keine Typen!) · `npm run build` · `npm run lint`.
  Kein Test-Skript vorhanden.
- **Migrationen**: Datei in `supabase/migrations/`, per Management-API einspielen; RLS-Policies je Operation prüfen
  (Admins durften fremde `time_entries` lange nicht anlegen).
- Änderungswünsche: Melde-Knopf (Bildschirmfoto, Text oder Sprachnachricht) → Tabelle `aenderungswuensche` →
  pg_net-Trigger ans epower-CRM (`app.epowergmbh.at`, app_key `birgmann`). Reine Sprachnachricht schickt einen
  Platzhalter-Text, die Abschrift ersetzt ihn per UPDATE (sonst lehnt das CRM mit „id und text nötig“ ab).

## Bekannte Fallstricke
- **Weiße Seite**: meist ein Render-Fehler (z. B. Icon benutzt, aber nicht importiert → `undefined`). Seit 26.06.2026
  fängt `<ErrorBoundary>` (`src/components/ErrorBoundary.tsx`) Render-Fehler ab; ein Fehler beim Laden eines Moduls
  (z. B. fehlende Supabase-Env in `client.ts`) wird trotzdem weiß. Erst `npx tsc --noEmit` laufen lassen. Fehler hinter
  dem Login zeigen sich erst mit Daten (Startseite „Aktive Projekte“).
- **Endlos „Lädt..“ / nur `/auth/v1/*` hängt** (23.08.2026, Supabase-Gateway): Diagnose
  `curl -m 8 -H "apikey: <publishable>" https://irfhbetcnxhuvoxgjeym.supabase.co/auth/v1/health` hängt, anderes Projekt
  antwortet sofort. Fix: Legacy-Keys per Management-API kurz aus- und einschalten
  (`PUT /v1/projects/<ref>/api-keys/legacy?enabled=false`, ~10 s warten, `…enabled=true`). Projekt-Neustart,
  Auth-Config-PATCH und neuer Key halfen nicht. Dabei `site_url` auf `https://birgmann.app` korrigiert.
- **Logo**: einzige Quelle `public/birgmann-logo.png` (muss echtes PNG bleiben – der Regiebericht bettet es per jsPDF `addImage(…,"PNG")` ein).
  App-Icons sind eigene quadratische Dateien (`icon-192.png`, `icon-512.png`, `icon.png`, `apple-touch-icon.png`,
  `favicon.ico`; Manifest in `vite.config.ts`), seit 26.06.2026 Birgmann-Stuhl statt Möbel Eder. Bildbearbeitung mit
  Python/Pillow (kein ImageMagick).
- Rechnungs- und Stundenauswertungs-Druckfenster: Nutzertexte immer escapen (`esc()`, `ohneSkripte()`, 25.10.2026).

## Wissen nach Thema
Hier gibt es (noch) keine Dateien unter `.claude/rules/` – der Ordner `.claude/` steht in `.gitignore`. Das Wissen steht
deshalb vollständig in dieser Datei; solange `.claude/` ignoriert wird, neues Wissen hier
(Abschnitte oben) ergänzen statt in `.claude/rules/`. Verlauf und Roboter-Protokolle: `JOURNAL.md` – nie ganz lesen, gezielt per grep
suchen.

## Wissen ablegen (für jede KI – auch den Roboter)
- Diese Datei ist die kurze Kundenakte und bleibt unter 25 KB. Hier nur: wer der Kunde ist, feste Regeln, Technik, Index.
- Neue Erkenntnis, Fallstrick oder Entscheidung zu einem Thema → in die passende Datei unter `.claude/rules/`
  (mit Datum und, wenn von Christoph/Kunde, dem Zitat). Gibt es kein passendes Thema: neue Datei mit `paths:` auf die
  betroffenen Code-Ordner anlegen und oben im Index eintragen.
- Ausführliche Protokolle, Testberichte, Abläufe → `JOURNAL.md` oder `research_notes/`, nicht hierher.
