// Grundtest 15.11.2026: Anmelden je Rolle über das echte Formular, was die Startseite je Rolle zeigt,
// und was ein Mitarbeiter NICHT darf (Admin-Seiten, fremde Stunden, sich selbst zum Admin machen …).
// Läuft NUR gegen die Testumgebung mit anonymisierten Echtdaten (testumgebung.mjs start + daten):
// TEST_API_URL=… TEST_ANON_KEY=… TEST_SERVICE_ROLE_KEY=… TEST_APP_URL=http://localhost:55210 npx playwright test -c tests/roboter/playwright.config.ts
import { expect, test, type Page } from "@playwright/test";
import { APP, PW, alsKonto, aufraeumen, anmelden, fehlerSammeln, konto, nurTestumgebung, rest, type Konto } from "./hilfen/testumgebung";

nurTestumgebung();
test.afterAll(aufraeumen);

async function perFormular(page: Page, email: string, passwort: string) {
  await page.goto(`${APP}/auth`);
  await page.evaluate(() => localStorage.setItem("pwa-install-dismissed", "1"));
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(passwort);
  await page.locator("form").getByRole("button", { name: "Anmelden" }).click();
}
const kachel = (page: Page, titel: string) => page.getByRole("heading", { name: titel, exact: true });

test("Anmelden: Admin sieht Verwaltung, Mitarbeiter nur seine Kacheln, falsches Passwort wird abgelehnt", async ({ browser }) => {
  const admin = await konto("Grundadmin", "administrator");
  const ma = await konto("Grundma", "mitarbeiter");

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const fehler = fehlerSammeln(page);

  await perFormular(page, ma.email, "falsch-123");
  await expect(page.getByText("Fehler beim Anmelden").first()).toBeVisible();
  await expect(page).toHaveURL(/\/auth/);

  await perFormular(page, admin.email, PW);
  await expect(page.getByRole("heading", { name: "Admin Dashboard" })).toBeVisible();
  for (const t of ["Zeiterfassung", "Projekte", "Meine Stunden", "Regiearbeiten", "Stundenauswertung", "Disponierung", "Admin-Bereich"]) {
    await expect(kachel(page, t)).toBeVisible();
  }
  await expect(kachel(page, "Meine Dokumente")).toHaveCount(0);
  await kachel(page, "Admin-Bereich").click();
  await expect(page.getByRole("heading", { name: "Admin-Bereich" })).toBeVisible();
  await expect(page.getByText("Urlaubsverwaltung").first()).toBeVisible();
  await ctx.close();

  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  const fehler2 = fehlerSammeln(page2);
  await perFormular(page2, ma.email, PW);
  await expect(page2.getByRole("heading", { name: "Mein Dashboard" })).toBeVisible();
  for (const t of ["Zeiterfassung", "Projekte", "Meine Stunden", "Regiearbeiten", "Meine Dokumente"]) {
    await expect(kachel(page2, t)).toBeVisible();
  }
  for (const t of ["Stundenauswertung", "Disponierung", "Admin-Bereich"]) {
    await expect(kachel(page2, t)).toHaveCount(0);
  }
  await ctx2.close();
  expect([...fehler, ...fehler2]).toEqual([]);
});

test("Rechte: Mitarbeiter kommt nicht in Admin-Seiten und sieht/ändert keine fremden Daten", async ({ browser }) => {
  const ma: Konto = await konto("Grundrecht", "mitarbeiter");
  const token = ma.sitzung.access_token;

  // Seiten: Admin-Bereich und Disponierung schicken zurück zur Startseite
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const fehler = fehlerSammeln(page);
  await anmelden(page, ma);
  for (const pfad of ["/admin", "/resource-planning"]) {
    await page.goto(`${APP}${pfad}`);
    await expect(page.getByRole("heading", { name: "Mein Dashboard" })).toBeVisible();
    await expect(page).toHaveURL(`${APP}/`);
  }
  // Stundenauswertung: nur die eigenen Stunden, keine Mitarbeiter-Auswahl
  await page.goto(`${APP}/hours-report`);
  await expect(page.getByRole("heading", { name: "Stundenauswertung" })).toBeVisible();
  await expect(page.getByText("Mitarbeiter auswählen")).toHaveCount(0);
  await ctx.close();
  expect(fehler).toEqual([]);

  // Datenbank-Rechte (RLS) mit dem Token des Mitarbeiters, gegen die anonymisierten Echtdaten
  const fremde = await rest(`/rest/v1/time_entries?user_id=neq.${ma.id}&select=id,user_id&limit=1`);
  expect(fremde.length, "Testumgebung braucht Echtdaten (testumgebung.mjs daten)").toBe(1);
  const fremderUser = fremde[0].user_id as string;

  const zeiten = await alsKonto(token, `/rest/v1/time_entries?select=id&user_id=eq.${fremderUser}`);
  expect(zeiten.json).toEqual([]);
  const mitarbeiter = await alsKonto(token, `/rest/v1/employees?select=id`);
  expect((mitarbeiter.json as unknown[]).length).toBeLessThanOrEqual(1); // nur der eigene Datensatz
  const rollen = await alsKonto(token, `/rest/v1/user_roles?select=user_id`);
  expect((rollen.json as { user_id: string }[]).every((r) => r.user_id === ma.id)).toBe(true);
  const berichte = await alsKonto(token, `/rest/v1/disturbances?select=id,user_id`);
  expect((berichte.json as { user_id: string }[]).every((r) => r.user_id === ma.id)).toBe(true);

  // Sich selbst zum Admin machen geht nicht
  await alsKonto(token, `/rest/v1/user_roles?user_id=eq.${ma.id}`, "PATCH", { role: "administrator" });
  await alsKonto(token, `/rest/v1/user_roles`, "POST", { user_id: ma.id, role: "administrator" });
  const meineRollen = await rest(`/rest/v1/user_roles?user_id=eq.${ma.id}&select=role`);
  expect(meineRollen.map((r: { role: string }) => r.role)).toEqual(["mitarbeiter"]);

  // Eigenes Arbeitszeitmodell ändern geht nicht (macht der Admin)
  await alsKonto(token, `/rest/v1/employees?user_id=eq.${ma.id}`, "PATCH", { wochenstunden: 10 });
  const ich = await rest(`/rest/v1/employees?user_id=eq.${ma.id}&select=wochenstunden`);
  expect(Number(ich[0].wochenstunden)).toBe(40);

  // Stunden für einen anderen eintragen oder fremde Stunden ändern/löschen geht nicht
  const fremdEintrag = await alsKonto(token, `/rest/v1/time_entries`, "POST", {
    user_id: fremderUser, datum: "2027-03-01", taetigkeit: "Arbeit", stunden: 8, start_time: "07:00", end_time: "15:30", pause_minutes: 30, location_type: "werkstatt",
  });
  expect(fremdEintrag.status).toBeGreaterThanOrEqual(400);
  const geaendert = await alsKonto(token, `/rest/v1/time_entries?id=eq.${fremde[0].id}`, "PATCH", { stunden: 99 });
  expect(geaendert.json).toEqual([]);
  const geloescht = await alsKonto(token, `/rest/v1/time_entries?id=eq.${fremde[0].id}`, "DELETE");
  expect(geloescht.json).toEqual([]);
  expect((await rest(`/rest/v1/time_entries?id=eq.${fremde[0].id}&select=id`)).length).toBe(1);
});
