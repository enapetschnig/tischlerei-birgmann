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
