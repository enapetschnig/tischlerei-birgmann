// Grundtest 15.11.2026: Regiebericht wie beim Kunden vor Ort – Mitarbeiter erfasst Bericht mit Material, Kunde
// unterschreibt, „Regiebericht senden“ läuft über die echte Edge Function send-disturbance-report (lokal mit Deno
// gegen die Testumgebung). Die Mail geht NICHT raus, sondern wird abgelegt; geprüft wird das angehängte PDF.
// Danach: Arbeitszeit gebucht, Status „gesendet“, Admin sieht den Bericht, ein anderer Mitarbeiter nicht.
// Läuft NUR gegen die Testumgebung: TEST_API_URL=… TEST_ANON_KEY=… TEST_SERVICE_ROLE_KEY=… TEST_APP_URL=… npx playwright test -c tests/roboter/playwright.config.ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { APP, alsKonto, anmelden, aufraeumen, edgeFunktionen, fehlerSammeln, konto, nurTestumgebung, rest } from "./hilfen/testumgebung";

nurTestumgebung();
test.afterAll(aufraeumen);
test.setTimeout(240_000);

const KUNDE = "ZZ Grundtest Kundin Lindner";
const TAG = "2027-03-10";

test("Regiebericht: erfassen, unterschreiben, senden – PDF hängt an, Zeit gebucht, nur Ersteller und Admin sehen ihn", async ({ browser }) => {
  const ma = await konto("Grundregie", "mitarbeiter");
  const admin = await konto("Grundbuero", "administrator");
  const anderer = await konto("Grundfremd", "mitarbeiter");

  const ctx = await browser.newContext();
  const edge = await edgeFunktionen(ctx, ["create-team-time-entries", "send-disturbance-report"]);
  try {
    const page = await ctx.newPage();
    const fehler = fehlerSammeln(page);
    await anmelden(page, ma);
    await page.goto(`${APP}/disturbances`);
    await page.getByRole("button", { name: "Neuer Regiebericht" }).first().click();

    const dialog = page.getByRole("dialog");
    await dialog.locator("#datum").fill(TAG);
    await dialog.locator("#startTime").fill("08:00");
    await dialog.locator("#endTime").fill("12:30");
    await dialog.locator("#pauseMinutes").fill("30");
    await dialog.locator("#kundeName").fill(KUNDE);
    await dialog.locator("#kundeEmail").fill("kundin.grundtest@example.invalid");
    await dialog.locator("#beschreibung").fill("Kuechenfront nachjustiert und Sockelleiste montiert");
    await dialog.getByRole("button", { name: /Material/ }).first().click();
    await dialog.getByPlaceholder("Material").first().fill("Sockelleiste Eiche");
    await dialog.getByPlaceholder("Menge").first().fill("3 lfm");
    await dialog.getByRole("button", { name: "Regiebericht erfassen" }).click();

    // Weiter zur Unterschrift (öffnet sich von selbst)
    await expect(page.getByRole("heading", { name: "Regiebericht zur Unterschrift" })).toBeVisible({ timeout: 20_000 });
    const unterschrift = page.getByRole("dialog").locator("canvas");
    await expect(unterschrift).toBeVisible();
    await page.waitForTimeout(600); // Öffnungs-Animation abwarten, sonst markiert die Maus Text
    const box = (await unterschrift.boundingBox())!;
    await page.mouse.move(box.x + 30, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + 30 + i * 20, box.y + box.height / 2 + (i % 2 ? -15 : 15));
    await page.mouse.up();
    await page.getByRole("button", { name: "Regiebericht senden" }).click();
    await expect(page.getByText("Der Bericht wurde erfolgreich per E-Mail versendet.").first()).toBeVisible({ timeout: 90_000 });
    expect(fehler).toEqual([]);

    // Datenbank: Bericht gesendet mit Unterschrift, Material, Arbeitszeit 4 h für den Ersteller
    const [bericht] = await rest(`/rest/v1/disturbances?user_id=eq.${ma.id}&select=id,status,stunden,unterschrift_kunde`);
    expect(bericht.status).toBe("gesendet");
    expect(Number(bericht.stunden)).toBe(4);
    expect(String(bericht.unterschrift_kunde)).toMatch(/^data:image\//);
    const material = await rest(`/rest/v1/disturbance_materials?disturbance_id=eq.${bericht.id}&select=material,menge`);
    expect(material).toEqual([{ material: "Sockelleiste Eiche", menge: "3 lfm" }]);
    const zeit = await rest(`/rest/v1/time_entries?user_id=eq.${ma.id}&datum=eq.${TAG}&select=stunden,disturbance_id,taetigkeit`);
    expect(zeit).toEqual([{ stunden: 4, disturbance_id: bericht.id, taetigkeit: `Regiebericht: ${KUNDE}` }]);

    // Mail mit PDF (abgelegt statt verschickt)
    const mails = readdirSync(edge.ablage);
    expect(mails).toHaveLength(1);
    const mail = JSON.parse(readFileSync(join(edge.ablage, mails[0]), "utf8"));
    expect(mail.to).toContain("kundin.grundtest@example.invalid");
    expect(mail.subject).toBe(`Regiebericht - ${KUNDE} - 10.03.2027`);
    expect(mail.attachments?.[0]?.filename).toBe("Regiebericht_ZZ_Grundtest_Kundin_Lindner_10-03-2027.pdf");
    const pdf = Buffer.from(mail.attachments[0].content, "base64");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(20_000); // mit Logo und Unterschrift
    const pdfText = pdf.toString("latin1");
    expect(pdfText).toContain(KUNDE);
    expect(pdfText).toContain("Sockelleiste Eiche");
    expect(pdfText).toMatch(/\/Subtype \/Image/);

    // Admin sieht den Bericht in der Liste und im Detail
    const seite = await ctx.newPage();
    const fehlerAdmin = fehlerSammeln(seite);
    await anmelden(seite, admin);
    await seite.goto(`${APP}/disturbances`);
    await seite.getByText(KUNDE).first().click();
    await expect(seite.getByRole("heading", { name: KUNDE })).toBeVisible();
    await expect(seite.getByRole("button", { name: "Als verrechnet markieren" })).toBeVisible();
    expect(fehlerAdmin).toEqual([]);

    // Ein anderer Mitarbeiter sieht ihn nicht
    const fremd = await alsKonto(anderer.sitzung.access_token, `/rest/v1/disturbances?id=eq.${bericht.id}&select=id`);
    expect(fremd.json).toEqual([]);
  } finally {
    edge.stop();
    await ctx.close();
  }
});
