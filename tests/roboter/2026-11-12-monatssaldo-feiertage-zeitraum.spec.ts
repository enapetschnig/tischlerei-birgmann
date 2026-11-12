// Probefahrt 12.11.2026 (Wunsch Petra): Meine Stunden zeigt Monatssoll + Plus/Minus,
// österreichische Feiertage haben kein Soll und werden beim Abwesenheits-Zeitraum übersprungen,
// Abwesenheit in der Zeiterfassung mit Von – Bis.
// Läuft NUR gegen die Testumgebung (testumgebung.mjs start), App mit VITE_SUPABASE_URL auf die Testumgebung:
// TEST_API_URL=… TEST_ANON_KEY=… TEST_SERVICE_ROLE_KEY=… TEST_APP_URL=http://localhost:55910 npx playwright test -c tests/roboter/playwright.config.ts
import { expect, test, type Page } from "@playwright/test";

const API = process.env.TEST_API_URL ?? "";
const ANON = process.env.TEST_ANON_KEY ?? "";
const SR = process.env.TEST_SERVICE_ROLE_KEY ?? "";
const APP = process.env.TEST_APP_URL ?? "http://localhost:55910";

test.skip(!API || !SR || !ANON, "nur mit Testumgebung");

const kopf = { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" };
async function rest(pfad: string, methode: string, daten?: unknown) {
  const r = await fetch(`${API}${pfad}`, { method: methode, headers: { ...kopf, Prefer: "return=representation" }, body: daten ? JSON.stringify(daten) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${methode} ${pfad}: ${r.status} ${t}`);
  return t ? JSON.parse(t) : null;
}
const PW = "Test1234!x";
type Konto = { id: string; sitzung: Record<string, unknown> & { access_token: string } };
async function konto(name: string, rolle: string, wochenstunden: number): Promise<Konto> {
  const email = `zztest.${name.toLowerCase()}.${Date.now()}@example.invalid`;
  const u = await rest("/auth/v1/admin/users", "POST", { email, password: PW, email_confirm: true });
  await rest("/rest/v1/profiles", "POST", { id: u.id, vorname: name, nachname: "Probe", is_active: true, anleitung_completed: true }).catch(() =>
    rest(`/rest/v1/profiles?id=eq.${u.id}`, "PATCH", { vorname: name, nachname: "Probe", is_active: true, anleitung_completed: true }));
  await rest(`/rest/v1/user_roles?user_id=eq.${u.id}`, "DELETE");
  await rest("/rest/v1/user_roles", "POST", { user_id: u.id, role: rolle });
  await rest(`/rest/v1/employees?user_id=eq.${u.id}`, "DELETE");
  await rest("/rest/v1/employees", "POST", { user_id: u.id, vorname: name, nachname: "Probe", wochenstunden });
  const sitzung = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PW }),
  }).then((r) => r.json());
  return { id: u.id, sitzung };
}
async function anmelden(page: Page, k: Konto) {
  await page.goto(`${APP}/auth`);
  await page.evaluate((s) => {
    localStorage.setItem("sb-127-auth-token", JSON.stringify(s));
    localStorage.setItem("pwa-install-dismissed", "1");
  }, k.sitzung);
}
const eintrag = (userId: string, datum: string, taetigkeit: string, stunden: number) => ({
  user_id: userId, datum, taetigkeit, stunden, start_time: "06:30", end_time: "15:30", pause_minutes: 60, location_type: "werkstatt",
});

test("Meine Stunden: Monatssoll ohne Feiertag, Plus/Minus; Zeiterfassung: Urlaub von–bis überspringt Feiertag und gebuchte Tage", async ({ browser }) => {
  const ma = await konto("Saldo", "mitarbeiter", 40);
  // Oktober 2026: 22 Werktage, 26.10. Nationalfeiertag → Soll 21 × 8 = 168 h
  await rest("/rest/v1/time_entries", "POST", [
    eintrag(ma.id, "2026-10-26", "Feiertag", 8), // händisch eingetragener Feiertag: zählt nicht doppelt
    eintrag(ma.id, "2026-10-01", "Arbeit", 10),
    eintrag(ma.id, "2026-10-02", "Urlaub", 8),
  ]);
  // Schon gebuchter Tag im Urlaubszeitraum
  await rest("/rest/v1/time_entries", "POST", [eintrag(ma.id, "2026-12-22", "Arbeit", 8)]);

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const fehler: string[] = [];
  page.on("pageerror", (e) => fehler.push(e.message));
  await anmelden(page, ma);

  await page.goto(`${APP}/my-hours`);
  await page.locator("#month-select").fill("2026-10");
  const saldo = page.getByTestId("monats-saldo");
  await expect(saldo).toContainText("Soll im Monat");
  await expect(saldo).toContainText("168,00");
  await expect(saldo).toContainText("18,00");
  await expect(saldo).toContainText("−150,00");
  await expect(saldo).toContainText("26.10. Nationalfeiertag");
  await expect(page.getByText("🎉 Nationalfeiertag")).toBeVisible();

  // Abwesenheit über Zeitraum: 21.12.–31.12.2026 → Mo–Do 21.–24., 28.–31. = 8 Arbeitstage, 25.12. Feiertag (Fr)
  await page.goto(`${APP}/time-tracking`);
  await page.getByRole("button", { name: /Abwesenheit/ }).first().click();
  await page.locator("#absence-date").fill("2026-12-21");
  await page.locator("#absence-date-to").fill("2026-12-31");
  await expect(page.getByTestId("abwesenheit-vorschau")).toContainText("8 Arbeitstage");
  await expect(page.getByTestId("abwesenheit-vorschau")).toContainText("1 Feiertag");
  await page.getByRole("button", { name: "Erfassen" }).click();
  await expect(page.getByText(/Urlaub erfasst vom 21\.12\.2026 bis 31\.12\.2026 \(7 Tage\)/).first()).toBeVisible();

  const urlaub = await rest(`/rest/v1/time_entries?user_id=eq.${ma.id}&taetigkeit=eq.Urlaub&datum=gte.2026-12-01&select=datum,stunden&order=datum`, "GET");
  expect(urlaub.map((u: { datum: string }) => u.datum)).toEqual([
    "2026-12-21", "2026-12-23", "2026-12-24", "2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31",
  ]);
  expect(urlaub.every((u: { stunden: number }) => Number(u.stunden) === 8)).toBe(true);

  // Einzelner Tag geht weiter wie bisher
  await page.getByRole("button", { name: /Abwesenheit/ }).first().click();
  await page.locator("#absence-date").fill("2027-01-04");
  await page.getByRole("button", { name: "Erfassen" }).click();
  await expect(page.getByText(/Urlaub erfasst am 04\.01\.2027/).first()).toBeVisible();

  expect(fehler).toEqual([]);
  await ctx.close();
});
