// Grundtest 15.11.2026: Was Petra im Admin-Bereich am häufigsten macht – Arbeitszeitmodell eines Mitarbeiters auf
// 38,5 Std. stellen (Mitarbeiter → Bearbeiten) und Urlaub für ihn eintragen (Urlaubsverwaltung → Abwesenheit
// eintragen). Die Urlaubsstunden kommen aus der Regelarbeitszeit des Modells (Woche = 38,5 h), der Mitarbeiter
// bekommt eine Benachrichtigung und sieht den Urlaub in Meine Stunden.
// Läuft NUR gegen die Testumgebung: TEST_API_URL=… TEST_ANON_KEY=… TEST_SERVICE_ROLE_KEY=… TEST_APP_URL=… npx playwright test -c tests/roboter/playwright.config.ts
import { expect, test } from "@playwright/test";
import { APP, anmelden, aufraeumen, fehlerSammeln, konto, nurTestumgebung, rest } from "./hilfen/testumgebung";

nurTestumgebung();
test.afterAll(aufraeumen);
test.setTimeout(150_000);

test("Admin: Arbeitszeitmodell 38,5 setzen und Urlaub für den Mitarbeiter eintragen", async ({ browser }) => {
  const admin = await konto("Grundpetra", "administrator");
  const ma = await konto("Grundurlaub", "mitarbeiter", 40);

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const fehler = fehlerSammeln(page);
  await anmelden(page, admin);
  await page.goto(`${APP}/admin`);
  await expect(page.getByRole("heading", { name: "Admin-Bereich" })).toBeVisible();

  // Mitarbeiter → Bearbeiten → Arbeitszeitmodell
  const karte = page.locator(`#registered-user-${ma.id}`);
  await karte.getByRole("button", { name: "Bearbeiten" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Grundurlaub Probe" })).toBeVisible();
  const modell = dialog.locator("div").filter({ has: page.locator("label", { hasText: /^Arbeitszeitmodell$/ }) }).last();
  await expect(modell.getByRole("combobox")).toContainText("40 Std. – Vollzeit");
  await modell.getByRole("combobox").click();
  for (const m of ["40 Std. – Vollzeit", "38,5 Std. – Vollzeit", "32 Std. – Teilzeit (Mi frei)", "20 Std. – Teilzeit (flexibel)", "10 Std. – Geringfügig (flexibel)"]) {
    await expect(page.getByRole("option", { name: m })).toBeVisible();
  }
  await page.getByRole("option", { name: "38,5 Std. – Vollzeit" }).click();
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Änderungen gespeichert").first()).toBeVisible();
  const [emp] = await rest(`/rest/v1/employees?user_id=eq.${ma.id}&select=wochenstunden`);
  expect(Number(emp.wochenstunden)).toBe(38.5);

  // Urlaubsverwaltung → Abwesenheit eintragen: Mo 15.03.–So 21.03.2027
  const abwesenheit = page.locator("div.rounded-lg, div.rounded-xl").filter({ has: page.getByText("Abwesenheit eintragen", { exact: true }) }).last();
  const feld = (name: string) => abwesenheit.locator("div").filter({ has: page.locator("label", { hasText: new RegExp(`^${name}$`) }) }).last();
  await feld("Mitarbeiter").getByRole("combobox").click();
  await page.getByRole("option", { name: "Grundurlaub Probe" }).click();
  await expect(feld("Art").getByRole("combobox")).toContainText("Urlaub");
  await feld("Von").locator("input").fill("2027-03-15");
  await feld("Bis").locator("input").fill("2027-03-21");
  await expect(abwesenheit).toContainText("5 Arbeitstage für Grundurlaub Probe");
  await abwesenheit.getByRole("button", { name: "Eintragen" }).click();
  await expect(page.getByText(/5 Tage \(15\.03\. – 19\.03\.2027\)/).first()).toBeVisible();
  expect(fehler).toEqual([]);
  await ctx.close();

  const urlaub = await rest(`/rest/v1/time_entries?user_id=eq.${ma.id}&taetigkeit=eq.Urlaub&select=datum,stunden&order=datum`);
  expect(urlaub.map((u: { datum: string }) => u.datum)).toEqual(["2027-03-15", "2027-03-16", "2027-03-17", "2027-03-18", "2027-03-19"]);
  const woche = urlaub.reduce((s: number, u: { stunden: number }) => s + Number(u.stunden), 0);
  expect(woche).toBeCloseTo(38.5, 2); // Regelarbeitszeit des 38,5-Modells, nicht 5 × 8 h
  const glocke = await rest(`/rest/v1/notifications?user_id=eq.${ma.id}&select=title`);
  expect(glocke.map((n: { title: string }) => n.title)).toContain("Urlaub eingetragen");

  // Der Mitarbeiter sieht den Urlaub in Meine Stunden
  const ctx2 = await browser.newContext();
  const seite = await ctx2.newPage();
  const fehler2 = fehlerSammeln(seite);
  await anmelden(seite, ma);
  await seite.goto(`${APP}/my-hours`);
  await seite.locator("#month-select").fill("2027-03");
  await expect(seite.getByText("Urlaub").first()).toBeVisible();
  await expect(seite.getByTestId("monats-saldo")).toContainText("38,50");
  expect(fehler2).toEqual([]);
  await ctx2.close();
});
