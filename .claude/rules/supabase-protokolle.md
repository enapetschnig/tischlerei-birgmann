---
paths:
  - "supabase/**"
---
# Supabase-Fehlerprotokolle – bekannte, harmlose Einträge

- 11.11.2026: `relation "cron.job" does not exist` (2×, 10.11. ~08:30 UTC) kam nicht von der App, sondern von einer projektübergreifenden Management-API-Abfrage (`mgmt-api`, epower-cockpit-Sitzung) auf `cron.job` – Birgmann hat kein pg_cron, App/Migrationen nutzen kein cron → harmlos, nichts ändern.
