---
paths:
  - "supabase/**"
---
# Supabase-Fehlerprotokolle – bekannte, harmlose Einträge

- 11.11.2026: `relation "cron.job" does not exist` (2×, 10.11. ~08:30 UTC) kam nicht von der App, sondern von einer projektübergreifenden Management-API-Abfrage (`mgmt-api`, epower-cockpit-Sitzung) auf `cron.job` – Birgmann hat kein pg_cron, App/Migrationen nutzen kein cron → harmlos, nichts ändern.
- 17.11.2026: `column "wochen_soll_stunden" does not exist` (1×, 16.11. 08:55 UTC) kam von einer Management-API-Abfrage (`mgmt-api`, Suche nach Falk Fabian beim ZA-Auftrag) – die Spalte gibt es nur in anderen Apps (bmrbau/schafferhoferbau), Birgmann nutzt `employees`-Modell ohne sie; App/Migrationen/Funktionen kennen sie nicht → harmlos, nichts ändern.
