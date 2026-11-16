// 16.11.2026 (Petra): „geht es das die Mitarbeiter auch Minus Stunden haben können? Das sie auch den ZA selbst eintragen können?“
// Prüft als MITARBEITER (nicht Admin): ZA selbst eintragen ohne Plus-Stunden (Einzeltag und von–bis),
// gespeichert unter dem eigenen Konto, und Meine Stunden zeigt danach ein Minus (ZA zählt nicht als Ist).
// Läuft NUR gegen die Testumgebung: TEST_API_URL=… TEST_ANON_KEY=… TEST_SERVICE_ROLE_KEY=… TEST_APP_URL=… npx playwright test -c tests/roboter/playwright.config.ts
import { expect, test } from "@playwright/test";
import { APP, anmelden, aufraeumen, fehlerSammeln, konto, nurTestumgebung, rest } from "./hilfen/testumgebung";

nurTestumgebung();
test.afterAll(aufraeumen);
test.setTimeout(150_000);

test("Mitarbeiter trägt ZA selbst ein und hat danach Minus-Stunden", async ({ browser }) => {
  const ma = await konto("Zaminus", "mitarbeiter", 40);
  await rest(`/rest/v1/time_accounts`, "POST", { user_id: ma.id, balance_hours: 0 });

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const fehler = fehlerSammeln(page);
  await anmelden(page, ma);

  const zaEintragen = async (von: string, bis?: string) => {
    await page.goto(`${APP}/time-tracking`);
    await page.getByRole("button", { name: "Abwesenheit" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("#absence-date").fill(von);
    if (bis) await dialog.locator("#absence-date-to").fill(bis);
    await dialog.getByText("⏰ ZA").click();
    await dialog.getByRole("button", { name: "Erfassen" }).click();
  };

  // Einzeltag Fr 02.10.2026 und Zeitraum Mo 05.10.–Di 06.10.2026, ohne Plus-Stunden
  await zaEintragen("2026-10-02");
  await expect(page.getByText("Zeitausgleich erfasst am 02.10.2026").first()).toBeVisible();
  await zaEintragen("2026-10-05", "2026-10-06");
  await expect(page.getByText(/Zeitausgleich erfasst vom 05\.10\.2026 bis 06\.10\.2026/).first()).toBeVisible();

  const za = await rest(`/rest/v1/time_entries?user_id=eq.${ma.id}&taetigkeit=eq.Zeitausgleich&select=datum,stunden&order=datum`);
  expect(za.map((z: { datum: string }) => z.datum)).toEqual(["2026-10-02", "2026-10-05", "2026-10-06"]);
  for (const z of za) expect(Number(z.stunden)).toBe(8);

  // Meine Stunden Oktober 2026: Soll 21 Werktage × 8 (26.10. Feiertag) = 168, Ist 0 (ZA zählt nicht) → Minus 168
  await page.goto(`${APP}/my-hours`);
  await page.locator("#month-select").fill("2026-10");
  await expect(page.getByText("Zeitausgleich").first()).toBeVisible();
  const saldo = page.getByTestId("monats-saldo");
  await expect(saldo).toContainText("Plus/Minus");
  await expect(saldo).toContainText(/−\s*168/);
  expect(fehler).toEqual([]);
  await ctx.close();
});
