---
paths:
  - src/lib/workingHours.ts
  - src/pages/MyHours.tsx
  - src/pages/TimeTracking.tsx
  - src/pages/HoursReport.tsx
  - src/components/TimeAccountManagement.tsx
  - src/components/AdminAbsenceEntry.tsx
---
# Soll, Plus/Minus und Feiertage

- **12.11.2026 (Petra)**: „bei der Monatsansicht … sehen wieviel Stunden sie im Monat brauchen und wieviel plus oder Minus“,
  „Österreichische Feiertage gleich eingetragen“, Urlaub/Krankenstand „nicht jeder Tag einzeln … zb. 12-15“.
- Feiertage werden **berechnet, nicht als Zeilen angelegt** (`getAustrianHolidays`/`isHoliday` in `workingHours.ts`,
  13 gesetzliche, ohne Karfreitag/24.12./31.12./Landespatron). Feiertag = Soll 0; Abwesenheits-Einträge an einem
  Feiertag (z. B. die 5 händischen „Feiertag“-Zeilen vom 26.10.2026) zählen dabei nicht, Arbeit am Feiertag = Plus.
  So bleibt der Saldo gleich, egal ob jemand den Feiertag noch händisch einträgt.
- Eine Rechnung für Meine Stunden und Monatsabschluss: `calculateMonthBalance` (flexible 20/10 h: Wochenstunden/5 je
  Werktag, wie der Monatsabschluss schon vorher). Stundenauswertung-ZA rechnet weiter nur Tage mit Einträgen, aber
  ebenfalls feiertagsneutral (`calculateDifference`). `getNormalWorkingHours` bleibt Regelarbeitszeit (ohne Feiertag),
  weil die Excel „ohne ZA“ daraus die Regelzeiten schreibt.
- Abwesenheit von–bis gibt es in der Zeiterfassung (alle Rollen) und im Admin-Bereich → Urlaubsverwaltung; beide
  überspringen Wochenenden, freie Tage, Feiertage und schon gebuchte Tage. ZA über Zeitraum: eine Abbuchung gesamt.
- **12.11.2026 (Nachprüfung)**: Flexible Modelle (20/10 h) haben Regelarbeitszeit 0 – Abwesenheit (von–bis und
  Einzeltag, Zeiterfassung + Urlaubsverwaltung) rechnet deshalb über `getAbsenceDayHours` (Wochenstunden / 5 je
  Werktag, sonst Regelarbeitszeit). Für Abwesenheits-Tage nie direkt `getNormalWorkingHours` nehmen.
- **12.11.2026 (Petra, Scan der Stundenauswertung)**: „1 Zeile soll die gesamte Arbeitszeit des Tages + Pause notiert
  sein / Nächste Zeilen Stunden (nur die Menge) + Projekt / Zum Schluss die gesamte Zeit des Tages“, „WIR BRAUCHEN NUR
  STUNDEN VOM PROJEKT“. → Tagesblock in `HoursReport.tsx` (`summarizeDay`): von–bis (früheste/späteste Zeit) + Pause
  gesamt, je Projekt nur Stunden (nach Beginn sortiert, Ort/Tätigkeit klein darunter), Tagessumme mit ZA; reiner
  Abwesenheitstag = eine Zeile. Admin-Stift neben der Tageszahl (keine eigene Spalte, passt aufs Handy). Excel-Layout
  unverändert.
- **Stunden immer aus `stunden` (gebucht), nie aus Beginn/Ende neu rechnen.** Die Zeiterfassung schlägt die ganze
  Tagespause dem ersten Eintrag zu; die Stundenauswertung zog bis 12.11.2026 pauschal 12–13 Uhr ab und lag an 63 Tagen
  (Juni–Nov.) daneben, netto 30,75 h zu wenig – ZA dort zu niedrig, Meine Stunden/Monatsabschluss waren richtig.
- **13.11.2026 (Gegenprobe)**: Auch das Excel-Archiv beim Löschen eines Mitarbeiters (`Admin.tsx`,
  `calculateExportHours`) rechnete noch Beginn/Ende minus 12–13 Uhr – jetzt ebenfalls gebuchte `stunden`.
- **15.11.2026 (Grundtest)**: Urlaubsverwaltung → Abwesenheit eintragen las die Arbeitszeitmodelle nur beim Öffnen des
  Admin-Bereichs – Modell auf 38,5 umstellen und gleich Urlaub eintragen gab 5 × 8 h statt 38,5 h. Jetzt liest
  `AdminAbsenceEntry` das Modell bei Auswahl und beim Eintragen frisch; nach „Regelarbeitszeiten speichern“ lädt
  `Admin.tsx` den Cache sofort neu (vorher bis zum Neuladen Standardzeiten).
- **16.11.2026 (Petra: „Bei Falk Fabian geht es nicht das man am 02.10 u. 16.10 ZA einträgt“)**: ZA buchte bisher vom
  Zeitkonto ab und brach bei zu wenig Guthaben ab – das Konto steht aber nach jedem Monatsabschluss (Barauszahlung) auf 0,
  bei allen Mitarbeitern, also ging ZA nie. Neu: ZA geht immer (Zeiterfassung und Urlaubsverwaltung → Abwesenheit
  eintragen), kein Abbuchen mehr; der ZA-Eintrag behält seine Stunden, zählt im Plus/Minus aber nicht als Ist
  (`isZaActivity` in `getSaldoIstHours` und `calculateDifference`) → Meine Stunden, Stundenauswertung und Monatsabschluss
  ziehen ihn vom Plus ab. Ersetzt „Urlaub, Krankenstand und ZA zählen wie gearbeitet“ vom 12.11. (galt nur mit Abbuchen).
  Händisches „Abzug“ im Zeitkonto für ZA-Tage nicht zusätzlich verwenden (sonst doppelt). Stundenauswertung: Admin-Stift
  jetzt auch an leeren Werktagen (öffnet die Zeiterfassung des Mitarbeiters für diesen Tag).
