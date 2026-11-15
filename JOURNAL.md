# Journal – Tischlerei Birgmann

## 2026-09-24 · Roboter · Wunsch von Petra Birgmann

**Meldung:** „Habe das Arbeitsmodell angepasst auf 38,5 Stunden und gespeichert. Kann aber bei Frau Wintersteller nur 40, 32, 20 oder 10 Stunden wählen.“

**Ursache:** Bei der 38,5-Std.-Änderung vom 21.09. (Commit 72dc565) wurde die neue Auswahl nur auf der Seite `/employees` (`src/pages/Employees.tsx`) eingebaut. Diese Seite ist in der App nirgends verlinkt. Petra bearbeitet Mitarbeiter im Admin-Bereich (Mitarbeiter → Stammdaten → Arbeitszeitmodell), und dort fehlte 38,5. Außerdem wurde der Wert dort als ganze Zahl gelesen (`parseInt`), aus 38,5 wäre also 38 geworden, und die Datenbank hätte das abgelehnt.

**Geändert:**
- `src/pages/Admin.tsx`: Die Auswahl „Arbeitszeitmodell“ wird jetzt aus der gemeinsamen Modell-Liste erzeugt (`ALL_MODELS` + `getWorkModelLabel` aus `src/lib/workingHours.ts`). Dadurch gibt es jetzt „38,5 Std. – Vollzeit“, und neue Modelle erscheinen künftig automatisch. Der Wert wird als Kommazahl gelesen (`parseFloat`).
- Die Beschriftungen kommen jetzt aus derselben Quelle wie im Zeitkonto und im Stundenexport (z.B. „40 Std. – Vollzeit“ statt „40 Std. – Vollzeit (Mo–Fr)“).
- In `Admin.tsx` fehlte `wochenstunden` in der Mitarbeiter-Beschreibung (interface `Employee`). Das Feld ist ergänzt, damit verschwinden zwei TypeScript-Fehler an der Auswahl, die es schon vorher gab. Das hat nichts am Verhalten geändert.
- Keine Datenbank-Änderung: Die Spalte und die Prüfregel erlauben 38,5 schon seit Migration `20260921100000_arbeitszeitmodell_38_5.sql`. Am 24.09. lesend geprüft: Die Regelarbeitszeiten je Modell sind gespeichert, alle 9 Mitarbeiter stehen auf 40.

**Offene Punkte:**
- Frau Wintersteller steht noch auf 40 Std. Entweder stellt Petra sie jetzt selbst auf 38,5 um, oder Christoph macht das.
- Nach dem Deploy die App einmal neu laden (die PWA liefert sonst evtl. noch die alte Version aus).
- Die tote Seite `/employees` (`src/pages/Employees.tsx`, Route in `src/App.tsx`) ist noch da. Nicht entfernt, weil Christoph das noch nicht freigegeben hat. Solange sie bleibt, besteht die Gefahr, dass Änderungen wieder dort statt im Admin-Bereich landen.
- Die Antwort an Petra vom 21.09. hat auf „Mitarbeiterverwaltung → Bearbeiten“ verwiesen, also auf diese tote Seite. Richtig ist: Admin-Bereich → Mitarbeiter → Bearbeiten → Arbeitszeitmodell.

## 2026-11-12 · Claude · Stundenauswertung übersichtlicher (Mail + Scan von Petra)

**Wunsch:** „1 Zeile soll die gesamte Arbeitszeit des Tages + Pause notiert sein / Nächste Zeilen Stunden (nur die Menge) + Projekt / Zum Schluss die gesamte Zeit des Tages / Momentan unübersichtlich.“ Auf dem Scan (Steiner Christian, 01.10.) handschriftlich: „WIR BRAUCHEN NUR STUNDEN VOM PROJEKT“, eine Zeile mit „4.00 h“ eingekreist und „8.50 h“ als richtige Tagessumme dazugeschrieben.

**Ursache „unübersichtlich“:** Je Eintrag eine Zeile mit Vormittag/Pause/Nachmittag; „Vormittag“ endete fest auf 12:00 (ergab „15:00 - 12:00“), die Einträge standen in Anlegereihenfolge statt nach Uhrzeit, und die Stunden je Zeile wurden aus Beginn/Ende mit pauschal 12–13 Uhr Pause neu gerechnet statt die gebuchten `stunden` zu nehmen.

**Geändert (`src/pages/HoursReport.tsx`):**
- Bildschirm: Spalten Datum | Arbeitszeit / Projekt | Stunden | ZA. Je Tag: Zeile „06:00 – 16:00 · Pause 60 Min.“, dann je Projekt Name + Stunden (Ort/Tätigkeit klein darunter), dann „Tagessumme“ mit ZA. Urlaub/Krankenstand-Tage eine Zeile. Admin-Stift neben der Tageszahl.
- Stunden, Summe, ZA und Excel-Werte jetzt aus `stunden` – gleich wie Meine Stunden und Monatsabschluss. Excel-Layout sonst unverändert (Einträge jetzt nach Uhrzeit sortiert).
- Geprüft mit lokaler Vorschau (echte Oktober-Daten Steiner Christian, Desktop + 390 px Handy): 01.10. = 8.50 h, Monat 189.25 h, ZA +14.75 h.

**Auswirkung:** Die alte Rechnung lag an 63 Tagen (Juni–Nov.) daneben, netto 30,75 h zu wenig (Okt.: David Hochradl +5,25 h, Fabian Falk +4,75 h, Hans Maislinger +2,00 h, Johann Grömer +2,00 h; Sep.: Fabian Falk +4,25 h; Nov.: Fabian Falk +2,50 h). Die ZA in der Stundenauswertung steigt für diese Monate entsprechend; Meine Stunden und Monatsabschluss bleiben, wie sie waren.

## 2026-11-15 · Claude · Grundtests (Auftrag Christoph)
- 4 neue Playwright-Dateien unter `tests/roboter/` (Anmelden/Rechte, Stunden erfassen, Regiebericht + PDF, Admin
  Modell + Urlaub), Helfer in `tests/roboter/hilfen/`. Alle 6 Tests grün gegen die Testumgebung mit Echtdaten.
- Dabei gefunden und behoben: Abwesenheit eintragen (Admin) nahm nach Modellwechsel im selben Admin-Bereich noch das
  alte Modell (40 statt 38,5 h); Regelarbeitszeiten-Cache nach dem Speichern sofort neu laden.
