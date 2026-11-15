// Gemeinsame Helfer für die Roboter-Tests – laufen NUR gegen die Testumgebung (testumgebung.mjs start + daten),
// nie gegen die echte Datenbank. Umgebung: TEST_API_URL, TEST_ANON_KEY, TEST_SERVICE_ROLE_KEY, TEST_APP_URL.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, type BrowserContext, type Page } from "@playwright/test";

export const API = process.env.TEST_API_URL ?? "";
export const ANON = process.env.TEST_ANON_KEY ?? "";
export const SR = process.env.TEST_SERVICE_ROLE_KEY ?? "";
export const APP = process.env.TEST_APP_URL ?? "http://localhost:55210";
export const PW = "Test1234!x";

/** Am Anfang jeder Datei: ohne Testumgebung überspringen; echte Projekt-URL ablehnen. */
export function nurTestumgebung() {
  test.skip(!API || !SR || !ANON, "nur mit Testumgebung");
  if (/supabase\.co/.test(API)) throw new Error("Roboter-Tests nie gegen die echte Datenbank laufen lassen");
}

const kopf = () => ({ apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" });
export async function rest(pfad: string, methode = "GET", daten?: unknown, token?: string) {
  const headers = token
    ? { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation" }
    : { ...kopf(), Prefer: "return=representation" };
  const r = await fetch(`${API}${pfad}`, { method: methode, headers, body: daten ? JSON.stringify(daten) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${methode} ${pfad}: ${r.status} ${t}`);
  return t ? JSON.parse(t) : null;
}
/** Wie rest(), aber mit dem Token eines Test-Kontos und ohne Werfen – für Rechte-Prüfungen. */
export async function alsKonto(token: string, pfad: string, methode = "GET", daten?: unknown) {
  const r = await fetch(`${API}${pfad}`, {
    method: methode,
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: daten ? JSON.stringify(daten) : undefined,
  });
  const t = await r.text();
  let json: unknown = null;
  try { json = t ? JSON.parse(t) : null; } catch { json = t; }
  return { status: r.status, json };
}

export type Konto = { id: string; email: string; vorname: string; sitzung: Record<string, unknown> & { access_token: string } };
const angelegt: string[] = [];

export async function konto(vorname: string, rolle: "administrator" | "mitarbeiter", wochenstunden = 40): Promise<Konto> {
  const email = `zztest.${vorname.toLowerCase()}.${Date.now()}@example.invalid`;
  const u = await rest("/auth/v1/admin/users", "POST", { email, password: PW, email_confirm: true });
  angelegt.push(u.id);
  const profil = { vorname, nachname: "Probe", is_active: true, anleitung_completed: true };
  await rest("/rest/v1/profiles", "POST", { id: u.id, ...profil }).catch(() => rest(`/rest/v1/profiles?id=eq.${u.id}`, "PATCH", profil));
  await rest(`/rest/v1/user_roles?user_id=eq.${u.id}`, "DELETE");
  await rest("/rest/v1/user_roles", "POST", { user_id: u.id, role: rolle });
  await rest(`/rest/v1/employees?user_id=eq.${u.id}`, "DELETE");
  await rest("/rest/v1/employees", "POST", { user_id: u.id, vorname, nachname: "Probe", wochenstunden });
  const sitzung = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PW }),
  }).then((r) => r.json());
  return { id: u.id, email, vorname, sitzung };
}

/** Löscht alle in dieser Datei angelegten Test-Konten samt ihren Daten (Konten-Löschung kaskadiert). */
export async function aufraeumen() {
  for (const id of angelegt.splice(0)) {
    await rest(`/rest/v1/disturbances?user_id=eq.${id}`, "DELETE").catch(() => {});
    await rest(`/auth/v1/admin/users/${id}`, "DELETE").catch(() => {});
  }
  await rest(`/rest/v1/projects?name=like.ZZ-Grundtest*`, "DELETE").catch(() => {});
}

/** Sitzung direkt in den Browser legen (schneller als das Anmeldeformular). */
export async function anmelden(page: Page, k: Konto) {
  await page.goto(`${APP}/auth`);
  await page.evaluate((s) => {
    localStorage.setItem("sb-127-auth-token", JSON.stringify(s));
    localStorage.setItem("pwa-install-dismissed", "1");
  }, k.sitzung);
}

export function fehlerSammeln(page: Page) {
  const fehler: string[] = [];
  page.on("pageerror", (e) => fehler.push(e.message));
  return fehler;
}

/**
 * Startet die echten Edge Functions aus supabase/functions mit Deno gegen die Testumgebung
 * und leitet die Aufrufe des Browsers dorthin um. Mails (Resend) landen in `ablage`, nichts geht nach außen.
 */
export async function edgeFunktionen(ctx: BrowserContext, namen: string[]) {
  const port = 55900 + Math.floor(Math.random() * 90);
  const ablage = mkdtempSync(join(tmpdir(), "birgmann-mails-"));
  const proc: ChildProcess = spawn("npx", ["-y", "deno", "run", "-A", "--no-lock", fileURLToPath(new URL("./edge-lokal.ts", import.meta.url)), String(port), ...namen], {
    env: { ...process.env, SUPABASE_URL: API, SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SR, RESEND_API_KEY: "test-nur-lokal", MAIL_ABLAGE: ablage },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  proc.stdout?.on("data", (d) => (log += d));
  proc.stderr?.on("data", (d) => (log += d));
  const bis = Date.now() + 120_000;
  for (;;) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/functions/v1/gesund`)).ok) break;
    } catch { /* startet noch */ }
    if (proc.exitCode !== null || Date.now() > bis) throw new Error(`Edge Functions starten nicht:\n${log}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  await ctx.route(`${API}/functions/v1/**`, async (route) => {
    const url = route.request().url().replace(API, `http://127.0.0.1:${port}`);
    await route.fulfill({ response: await route.fetch({ url }) });
  });
  return { ablage, log: () => log, stop: () => proc.kill() };
}
