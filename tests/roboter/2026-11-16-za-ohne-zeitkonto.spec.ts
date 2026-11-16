// 16.11.2026 (Petra): „Bei Falk Fabian geht es nicht das man am 02.10 u. 16.10 ZA einträgt“.
// Ursache: ZA wurde nur eingetragen, wenn das Zeitkonto genug Stunden hatte – das Konto steht nach jedem
// Monatsabschluss (Auszahlung) auf 0, also ging ZA nie. Jetzt: ZA geht immer, der ZA-Tag zählt im
// Plus/Minus nicht als Ist (zieht die Stunden vom Plus ab), das Zeitkonto bleibt unberührt.
// Läuft NUR gegen die Testumgebung: TEST_API_URL=… TEST_ANON_KEY=… TEST_SERVICE_ROLE_KEY=… TEST_APP_URL=… npx playwright test -c tests/roboter/playwright.config.ts
import { expect, test } from "@playwright/test";
import { APP, anmelden, aufraeumen, fehlerSammeln, konto, nurTestumgebung, rest } from "./hilfen/testumgebung";

nurTestumgebung();
test.afterAll(aufraeumen);
test.setTimeout(150_000);

test("Admin trägt ZA ein, obwohl das Zeitkonto auf 0 steht – Zeiterfassung und Urlaubsverwaltung", async ({ browser }) => {
  const admin = await konto("Zapetra", "administrator");
  const ma = await konto("Zatischler", "mitarbeiter", 40);
  // Zeitkonto wie bei allen echten Mitarbeitern: 0 Std.
  await rest(`/rest/v1/time_accounts`, "POST", { user_id: ma.id, balance_hours: 0 });
  // Ein Arbeitstag mit Überstunden
  await rest(`/rest/v1/time_entries`, "POST", {
    user_id: ma.id, datum: "2026-10-01", stunden: 10.75, start_time: "06:00", end_time: "17:30",
    pause_minutes: 45, taetigkeit: "", location_type: "baustelle",
  });

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const fehler = fehlerSammeln(page);
  await anmelden(page, admin);

  // 1) Zeiterfassung für den Mitarbeiter (Stift in der Stundenauswertung) → Abwesenheit → ZA am Fr 02.10.
  await page.goto(`${APP}/time-tracking?user_id=${ma.id}&date=2026-10-02`);
  await expect(page.getByText("Zeiterfassung – Zatischler Probe")).toBeVisible();
  await page.getByRole("button", { name: "Abwesenheit" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("⏰ ZA").click();
  await dialog.getByRole("button", { name: "Erfassen" }).click();
  await expect(page.getByText("Zeitausgleich erfasst am 02.10.2026").first()).toBeVisible();

  // 2) Admin-Bereich → Urlaubsverwaltung → Abwesenheit eintragen: ZA am Fr 16.10.
  await page.goto(`${APP}/admin`);
  const abwesenheit = page.locator("div.rounded-lg, div.rounded-xl").filter({ has: page.getByText("Abwesenheit eintragen", { exact: true }) }).last();
  const feld = (name: string) => abwesenheit.locator("div").filter({ has: page.locator("label", { hasText: new RegExp(`^${name}$`) }) }).last();
  await feld("Mitarbeiter").getByRole("combobox").click();
  await page.getByRole("option", { name: "Zatischler Probe" }).click();
  await feld("Art").getByRole("combobox").click();
  await page.getByRole("option", { name: "⏰ Zeitausgleich (ZA)" }).click();
  await feld("Von").locator("input").fill("2026-10-16");
  await feld("Bis").locator("input").fill("2026-10-16");
  await expect(abwesenheit).toContainText("1 Arbeitstag für Zatischler Probe");
  await abwesenheit.getByRole("button", { name: "Eintragen" }).click();
  await expect(page.getByText("Zeitausgleich eingetragen").first()).toBeVisible();
  expect(fehler).toEqual([]);
  await ctx.close();

  const za = await rest(`/rest/v1/time_entries?user_id=eq.${ma.id}&taetigkeit=eq.Zeitausgleich&select=datum,stunden&order=datum`);
  expect(za.map((z: { datum: string }) => z.datum)).toEqual(["2026-10-02", "2026-10-16"]);
  for (const z of za) expect(Number(z.stunden)).toBeGreaterThan(0);
  const [konto0] = await rest(`/rest/v1/time_accounts?user_id=eq.${ma.id}&select=balance_hours`);
  expect(Number(konto0.balance_hours)).toBe(0);

  // 3) Meine Stunden des Mitarbeiters: ZA-Tage zählen nicht als Ist (nur die 10,75 Std. Arbeit)
  const ctx2 = await browser.newContext();
  const seite = await ctx2.newPage();
  const fehler2 = fehlerSammeln(seite);
  await anmelden(seite, ma);
  await seite.goto(`${APP}/my-hours`);
  await seite.locator("#month-select").fill("2026-10");
  await expect(seite.getByText("Zeitausgleich").first()).toBeVisible();
  await expect(seite.getByTestId("monats-saldo")).toContainText("10,75");
  await expect(seite.getByText("ZA wird vom Plus abgezogen")).toBeVisible();
  expect(fehler2).toEqual([]);
  await ctx2.close();
});
