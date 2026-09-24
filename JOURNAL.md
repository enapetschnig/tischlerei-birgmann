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
