// 16.11.2026 (Petra, Startseite): „ich kann bei den Mitarbeiter keine Abwesenheit eintragen das fehlt bei mir“.
// Abwesenheit eintragen gab es nur unten in der Urlaubsverwaltung. Jetzt: Admin-Bereich → Registrierte Benutzer →
// beim Mitarbeiter Knopf „Abwesenheit“ → Dialog mit dem Mitarbeiter schon ausgewählt.
// Läuft NUR gegen die Testumgebung: TEST_API_URL=… TEST_ANON_KEY=… TEST_SERVICE_ROLE_KEY=… TEST_APP_URL=… npx playwright test -c tests/roboter/playwright.config.ts
import { expect, test } from "@playwright/test";
import { APP, anmelden, aufraeumen, fehlerSammeln, konto, nurTestumgebung, rest } from "./hilfen/testumgebung";

nurTestumgebung();
test.afterAll(aufraeumen);
test.setTimeout(120_000);

test("Admin trägt Urlaub direkt beim Mitarbeiter in der Mitarbeiterliste ein", async ({ browser }) => {
  const admin = await konto("Abwpetra", "administrator");
  const ma = await konto("Abwtischler", "mitarbeiter", 40);

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const fehler = fehlerSammeln(page);
  await anmelden(page, admin);
  await page.goto(`${APP}/admin`);

  const zeile = page.locator(`#registered-user-${ma.id}`);
  await zeile.getByRole("button", { name: "Abwesenheit" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("combobox").first()).toContainText("Abwtischler Probe");
  const feld = (name: string) => dialog.locator("div").filter({ has: page.locator("label", { hasText: new RegExp(`^${name}$`) }) }).last();
  // Mo 07.12. – Mi 09.12.2026 (08.12. Feiertag → 2 Arbeitstage)
  await feld("Von").locator("input").fill("2026-12-07");
  await feld("Bis").locator("input").fill("2026-12-09");
  await expect(dialog).toContainText("2 Arbeitstage für Abwtischler Probe");
  await dialog.getByRole("button", { name: "Eintragen" }).click();
  await expect(page.getByText("Urlaub eingetragen").first()).toBeVisible();
  await expect(dialog).toBeHidden();
  expect(fehler).toEqual([]);
  await ctx.close();

  const rows = await rest(`/rest/v1/time_entries?user_id=eq.${ma.id}&select=datum,taetigkeit,stunden&order=datum`);
  expect(rows.map((r: { datum: string }) => r.datum)).toEqual(["2026-12-07", "2026-12-09"]);
  for (const r of rows) {
    expect(r.taetigkeit).toBe("Urlaub");
    expect(Number(r.stunden)).toBeGreaterThan(0);
  }
});
