// Grundtest 15.11.2026: Der tägliche Weg des Tischlers – Arbeitszeit mit Pausen-Rad eintragen, auf zwei Projekte
// verteilen (Stunden + Viertelstunden-Rad, „Rest übernehmen“), speichern über die echte Edge Function
// create-team-time-entries (lokal mit Deno gegen die Testumgebung). Danach sieht er den Tag in Meine Stunden und
// der Admin in der Stundenauswertung (mit Excel-Export).
// Läuft NUR gegen die Testumgebung: TEST_API_URL=… TEST_ANON_KEY=… TEST_SERVICE_ROLE_KEY=… TEST_APP_URL=… npx playwright test -c tests/roboter/playwright.config.ts
import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import XLSX from "xlsx-js-style";
import { APP, anmelden, aufraeumen, edgeFunktionen, fehlerSammeln, konto, nurTestumgebung, rest } from "./hilfen/testumgebung";

nurTestumgebung();
test.afterAll(aufraeumen);
test.setTimeout(180_000);

/** Radix-Auswahl über die Beschriftung im selben Block öffnen und Eintrag wählen. */
async function waehle(page: Page, bereich: Locator, beschriftung: string, eintrag: string, nr = 0) {
  const block = bereich.locator("div").filter({ has: page.locator("label", { hasText: new RegExp(`^${beschriftung}`) }) }).last();
  await block.getByRole("combobox").nth(nr).click();
  await page.getByRole("option", { name: eintrag, exact: true }).click();
}

const TAG = "2027-03-09"; // Dienstag, kein Feiertag

test("Stunden erfassen: Tag auf zwei Kommissionen verteilen, in Meine Stunden und Stundenauswertung sehen", async ({ browser }) => {
  const ma = await konto("Grundstunden", "mitarbeiter");
  const admin = await konto("Grundchef", "administrator");
  const [projA] = await rest("/rest/v1/projects", "POST", { name: "ZZ-Grundtest Komm Ahorn", plz: "5142", status: "aktiv" });
  const [projB] = await rest("/rest/v1/projects", "POST", { name: "ZZ-Grundtest Komm Buche", plz: "5142", status: "aktiv" });

  const ctx = await browser.newContext();
  const edge = await edgeFunktionen(ctx, ["create-team-time-entries"]);
  try {
    const page = await ctx.newPage();
    const fehler = fehlerSammeln(page);
    await anmelden(page, ma);
    await page.goto(`${APP}/time-tracking`);
    await page.locator("#date").fill(TAG);
    await expect(page.getByText("Noch keine Einträge für diesen Tag")).toBeVisible();

    const form = page.locator("form");
    await form.locator("input[type=time]").nth(0).fill("07:00");
    await form.locator("input[type=time]").nth(1).fill("16:00");
    await waehle(page, form, "Pause Vormittag", "15 Min.");
    await waehle(page, form, "Pause Mittag", "30 Min.");
    await expect(page.getByText("Netto-Arbeitszeit").locator("..")).toContainText("8:15");

    const zeile1 = page.locator("div.border.rounded-lg").filter({ has: page.getByRole("heading", { name: /^Projektzeit/ }) }).last();
    await zeile1.getByText("🔧 Werkstatt").click();
    await waehle(page, zeile1, "Projekt", "ZZ-Grundtest Komm Ahorn (5142)");
    await waehle(page, zeile1, "Dauer", "3 Std.", 0);
    await waehle(page, zeile1, "Dauer", "15 Min.", 1);

    await page.getByRole("button", { name: "Weitere Projektzeit hinzufügen" }).click();
    const zeile2 = page.locator("div.border.rounded-lg").filter({ has: page.getByRole("heading", { name: "Projektzeit 2" }) }).last();
    await zeile2.getByText("🏗️ Baustelle").click();
    await waehle(page, zeile2, "Projekt", "ZZ-Grundtest Komm Buche (5142)");
    await zeile2.getByRole("button", { name: "Rest übernehmen" }).click();
    await expect(page.getByText("Alles verteilt ✓")).toBeVisible();

    await page.getByRole("button", { name: "Stunden erfassen" }).click();
    await expect(page.getByText("2 Eintrag/Einträge gespeichert").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Bereits gebuchte Zeiten")).toBeVisible();
    await expect(page.getByText("8.25 Stunden")).toBeVisible();

    const zeilen = await rest(`/rest/v1/time_entries?user_id=eq.${ma.id}&datum=eq.${TAG}&select=project_id,stunden,start_time,end_time,pause_minutes,location_type&order=start_time`);
    expect(zeilen.map((z: Record<string, unknown>) => [z.project_id, Number(z.stunden), String(z.start_time).slice(0, 5), String(z.end_time).slice(0, 5), z.pause_minutes, z.location_type])).toEqual([
      [projA.id, 3.25, "07:00", "11:00", 45, "werkstatt"],
      [projB.id, 5, "11:00", "16:00", 0, "baustelle"],
    ]);

    // Meine Stunden: Monat März 2027 zeigt die 8,25 h
    await page.goto(`${APP}/my-hours`);
    await page.locator("#month-select").fill("2027-03");
    await expect(page.getByText("ZZ-Grundtest Komm Ahorn").first()).toBeVisible();
    await expect(page.getByText("ZZ-Grundtest Komm Buche").first()).toBeVisible();
    expect(fehler).toEqual([]);

    // Admin: Stundenauswertung des Mitarbeiters mit Tagesblock und Excel
    const seite = await ctx.newPage();
    const fehlerAdmin = fehlerSammeln(seite);
    await anmelden(seite, admin);
    await seite.goto(`${APP}/hours-report?employee=${ma.id}&month=3&year=2027`);
    const tabelle = seite.locator("table");
    await expect(tabelle).toContainText("07:00 – 16:00");
    await expect(tabelle).toContainText("ZZ-Grundtest Komm Ahorn");
    await expect(tabelle).toContainText("ZZ-Grundtest Komm Buche");
    await expect(seite.getByText("Gesamtstunden").locator("..")).toContainText("8.25 h");

    await seite.getByRole("button", { name: /Excel exportieren/ }).click();
    const [download] = await Promise.all([seite.waitForEvent("download"), seite.getByRole("menuitem", { name: "Mit ZA" }).click()]);
    expect(download.suggestedFilename()).toMatch(/^Arbeitszeiterfassung_.*\.xlsx$/);
    const mappe = XLSX.read(readFileSync(await download.path()), { type: "buffer" });
    const text = mappe.SheetNames.map((n) => XLSX.utils.sheet_to_csv(mappe.Sheets[n])).join("\n");
    expect(text).toContain("Grundstunden");
    expect(text).toMatch(/8[.,]25/);
    expect(fehlerAdmin).toEqual([]);
  } finally {
    edge.stop();
    await ctx.close();
  }
});
