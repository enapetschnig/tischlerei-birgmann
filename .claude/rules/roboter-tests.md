---
paths:
  - tests/roboter/**
---

# Roboter-Tests (Playwright gegen die Testumgebung)

- **15.11.2026 (Christoph: „Grundtests … für die 3–6 wichtigsten Abläufe“)**: `2026-11-15-grundtest-*.spec.ts` decken
  Anmelden je Rolle + Rechte (UI und RLS), Stunden erfassen (zwei Kommissionen) + Meine Stunden + Stundenauswertung/Excel,
  Regiebericht mit Unterschrift + PDF, Admin: Arbeitszeitmodell 38,5 + Urlaub eintragen ab. Rechnungen nicht: `/invoices`
  ist in `App.tsx` nicht verdrahtet (tote Seite).
- Gemeinsame Helfer in `tests/roboter/hilfen/testumgebung.ts` (Test-Konten anlegen + am Ende löschen, Sitzung setzen).
  Zeiterfassung und Regiebericht speichern über Edge Functions – die Testumgebung hat keine Edge-Laufzeit, darum startet
  `edgeFunktionen()` die echten Funktionen mit `npx -y deno` (`hilfen/edge-lokal.ts`) und leitet `/functions/v1/*` um.
  Resend-Mails werden dort abgelegt statt verschickt (PDF prüfbar), das Logo kommt aus `public/`.
- Aufruf: `TEST_API_URL=… TEST_ANON_KEY=… TEST_SERVICE_ROLE_KEY=… TEST_APP_URL=http://localhost:55210 npx playwright test
  -c tests/roboter/playwright.config.ts` (App mit `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` auf die Testumgebung).
  Rechte-Test braucht die Echtdaten (`testumgebung.mjs daten`).
- Echte Testumgebung hat noch das alte flache `regelarbeitszeiten`-Format (nur Vollzeit) – 38,5 wird daraus abgeleitet
  (Freitag kürzer, Woche = 38,5 h).
