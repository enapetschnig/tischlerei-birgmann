---
paths:
  - "supabase/**"
---
# Supabase-Fehlerprotokolle – bekannte, harmlose Einträge

- 11.11.2026: `relation "cron.job" does not exist` (2×, 10.11. ~08:30 UTC) kam nicht von der App, sondern von einer projektübergreifenden Management-API-Abfrage (`mgmt-api`, epower-cockpit-Sitzung) auf `cron.job` – Birgmann hat kein pg_cron, App/Migrationen nutzen kein cron → harmlos, nichts ändern.
- 17.11.2026: `column "wochen_soll_stunden" does not exist` (1×, 16.11. 08:55 UTC) kam von einer Management-API-Abfrage (`mgmt-api`, Suche nach Falk Fabian beim ZA-Auftrag) – die Spalte gibt es nur in anderen Apps (bmrbau/schafferhoferbau), Birgmann nutzt `employees`-Modell ohne sie; App/Migrationen/Funktionen kennen sie nicht → harmlos, nichts ändern.
- 19.11.2026: `555 /auth/v1/token?grant_type=refresh_token` (3×, 18.11. 18:12:38–18:13:00 UTC, ein Windows-Chrome, birgmann.app) = Gateway-Zeitlimit 10 s (`origin_time` 10000), Auth-Dienst hat die Anfragen nie protokolliert; supabase-js versuchte selbst neu, 18:13:38 → 200, andere Nutzer zeitgleich 200 → kurzer Supabase-Aussetzer, harmlos, nichts ändern (anders als der Dauer-Hänger vom 23.08., siehe CLAUDE.md).
