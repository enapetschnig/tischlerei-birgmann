import { supabase } from "@/integrations/supabase/client";

/**
 * Regelarbeitszeit eines Wochentags (admin-einstellbar im Admin-Bereich).
 * Pausen als Dauer in Minuten (Vormittag + Mittag), nicht als von/bis.
 */
export interface DayWorkTime {
  start: string; // "06:30"
  end: string; // "15:30"
  pauseVormittag: number; // Minuten
  pauseMittag: number; // Minuten
}

/** 1 = Montag ... 5 = Freitag */
export type WorkTimeSettings = Record<number, DayWorkTime>;

/**
 * Regelarbeitszeiten je Arbeitszeitmodell, Schlüssel = Wochenstunden als Text
 * ("40", "38.5", "32"). Flexible Modelle (20/10) haben keinen Plan.
 */
export type ModelWorkTimeSettings = Record<string, WorkTimeSettings>;

/** Modelle mit festem Wochenplan (Reihenfolge = Anzeige im Admin-Bereich). */
export const SCHEDULED_MODELS = [40, 38.5, 32] as const;
/** Flexible Modelle ohne Tagessoll. */
export const FLEXIBLE_MODELS = [20, 10] as const;
/** Alle wählbaren Modelle. */
export const ALL_MODELS = [...SCHEDULED_MODELS, ...FLEXIBLE_MODELS] as const;

export const modelKey = (wochenstunden: number): string => String(wochenstunden);

/** "38.5" -> "38,5" für die Anzeige. */
export const formatModelHours = (wochenstunden: number): string =>
  String(wochenstunden).replace(".", ",");

const DEFAULT_DAY: DayWorkTime = { start: "06:30", end: "15:30", pauseVormittag: 0, pauseMittag: 60 };

export const DEFAULT_WORK_TIME_SETTINGS: WorkTimeSettings = {
  1: { ...DEFAULT_DAY },
  2: { ...DEFAULT_DAY },
  3: { ...DEFAULT_DAY },
  4: { ...DEFAULT_DAY },
  5: { ...DEFAULT_DAY },
};

let settingsCache: ModelWorkTimeSettings | null = null;

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function minutesToTime(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Netto-Arbeitsminuten eines Regelarbeitstags (Ende - Beginn - Pausen). */
export function dayNetMinutes(day: DayWorkTime): number {
  return Math.max(0, timeToMinutes(day.end) - timeToMinutes(day.start) - day.pauseVormittag - day.pauseMittag);
}

/** Netto-Wochenminuten eines Plans. */
export function weekNetMinutes(week: WorkTimeSettings): number {
  return [1, 2, 3, 4, 5].reduce((sum, d) => sum + (week[d] ? dayNetMinutes(week[d]) : 0), 0);
}

function normalizeWeek(raw: Record<string, Partial<DayWorkTime>> | undefined): WorkTimeSettings {
  const result: WorkTimeSettings = {};
  for (let d = 1; d <= 5; d++) {
    const day = raw?.[String(d)] || {};
    result[d] = {
      start: day.start || DEFAULT_DAY.start,
      end: day.end || DEFAULT_DAY.end,
      pauseVormittag: Number(day.pauseVormittag ?? DEFAULT_DAY.pauseVormittag),
      pauseMittag: Number(day.pauseMittag ?? DEFAULT_DAY.pauseMittag),
    };
  }
  return result;
}

function cloneWeek(week: WorkTimeSettings): WorkTimeSettings {
  const result: WorkTimeSettings = {};
  for (let d = 1; d <= 5; d++) result[d] = { ...week[d] };
  return result;
}

/**
 * Leitet einen Plan für ein Modell aus dem 40h-Plan ab: gleiche Tage, aber der
 * Freitag wird so verkürzt, dass die Wochensumme stimmt (z.B. 38,5 h).
 * Reicht das nicht, bleibt die Kopie — der Admin passt dann selbst an.
 */
function deriveFromFullTime(fullTime: WorkTimeSettings, targetHours: number): WorkTimeSettings {
  const week = cloneWeek(fullTime);
  const monToThu = [1, 2, 3, 4].reduce((sum, d) => sum + dayNetMinutes(week[d]), 0);
  const fridayNet = Math.round(targetHours * 60 - monToThu);
  const friday = week[5];
  if (fridayNet > 0 && fridayNet < dayNetMinutes(friday)) {
    friday.end = minutesToTime(timeToMinutes(friday.start) + friday.pauseVormittag + friday.pauseMittag + fridayNet);
  }
  return week;
}

/** Fehlende Modelle auffüllen, damit jedes Modell einen Plan hat. */
function completeModels(models: ModelWorkTimeSettings): ModelWorkTimeSettings {
  const result: ModelWorkTimeSettings = { ...models };
  if (!result["40"]) result["40"] = cloneWeek(DEFAULT_WORK_TIME_SETTINGS);
  for (const m of SCHEDULED_MODELS) {
    const key = modelKey(m);
    if (!result[key]) {
      result[key] = m === 40 ? cloneWeek(result["40"]) : deriveFromFullTime(result["40"], m);
    }
  }
  return result;
}

/**
 * Lädt die Regelarbeitszeiten aus app_settings (Key 'regelarbeitszeiten') und cached sie.
 * Unterstützt das alte flache Format ({"1":..."5":...} = nur Vollzeit) und das
 * neue je Modell ({"40":{...},"38.5":{...},"32":{...}}).
 * Vor Soll-/Vorbelegungs-Berechnungen einmal awaiten; Fallback sind die Defaults.
 */
export async function loadWorkTimeSettings(): Promise<ModelWorkTimeSettings> {
  if (settingsCache) return settingsCache;
  try {
    const { data } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "regelarbeitszeiten")
      .maybeSingle();
    if (data?.value) {
      const parsed = JSON.parse(data.value) as Record<string, unknown>;
      let models: ModelWorkTimeSettings = {};
      if (parsed["1"] !== undefined) {
        // Altes Format: ein Plan für alle -> als Vollzeit übernehmen
        models["40"] = normalizeWeek(parsed as Record<string, Partial<DayWorkTime>>);
      } else {
        for (const [key, week] of Object.entries(parsed)) {
          models[key] = normalizeWeek(week as Record<string, Partial<DayWorkTime>>);
        }
      }
      models = completeModels(models);
      settingsCache = models;
      return models;
    }
  } catch {
    // Fallback unten
  }
  settingsCache = completeModels({});
  return settingsCache;
}

/** Cache verwerfen (nach dem Speichern im Admin-Bereich aufrufen). */
export function invalidateWorkTimeSettings(): void {
  settingsCache = null;
}

function getModelWeek(wochenstunden: number): WorkTimeSettings {
  const models = settingsCache ?? completeModels({});
  return models[modelKey(wochenstunden)] ?? models["40"] ?? DEFAULT_WORK_TIME_SETTINGS;
}

function getDaySetting(date: Date, wochenstunden: number): DayWorkTime | null {
  const dayOfWeek = date.getDay(); // 0=So ... 6=Sa
  if (dayOfWeek < 1 || dayOfWeek > 5) return null;
  return getModelWeek(wochenstunden)[dayOfWeek] ?? DEFAULT_DAY;
}

export function isFlexibleModel(wochenstunden: number): boolean {
  return (FLEXIBLE_MODELS as readonly number[]).includes(wochenstunden);
}

/**
 * Gibt zurück ob der Wochentag für dieses Arbeitszeitmodell ein freier Tag ist.
 * 32h-Modell: Mittwoch ist frei. Zusätzlich: Tage mit 0 Netto-Minuten im Plan.
 */
export function isFreierTag(date: Date, wochenstunden: number = 40): boolean {
  const dayOfWeek = date.getDay();
  if (wochenstunden === 32 && dayOfWeek === 3) return true; // Mittwoch
  if (dayOfWeek >= 1 && dayOfWeek <= 5 && !isFlexibleModel(wochenstunden)) {
    const day = getDaySetting(date, wochenstunden);
    if (day && dayNetMinutes(day) === 0) return true;
  }
  return false;
}

/**
 * Prüft ob ein Tag ein arbeitsfreier Tag ist (Wochenende oder Modell-freier Tag).
 */
export function isNonWorkingDay(date: Date, wochenstunden: number = 40): boolean {
  const dayOfWeek = date.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) return true; // Wochenende
  return isFreierTag(date, wochenstunden);
}

/**
 * Gibt die Sollstunden für einen bestimmten Tag zurück (aus den Regelarbeitszeiten
 * des jeweiligen Modells). 20h/10h: immer 0h (flexibel), 32h: Mittwoch frei.
 */
export function getNormalWorkingHours(date: Date, wochenstunden: number = 40): number {
  const dayOfWeek = date.getDay();

  // Wochenende: immer 0
  if (dayOfWeek === 0 || dayOfWeek === 6) return 0;

  // Flexible Modelle (20h / 10h): kein festes Tagesziel
  if (isFlexibleModel(wochenstunden)) return 0;

  // 32h-Modell: Mittwoch frei
  if (wochenstunden === 32 && dayOfWeek === 3) return 0;

  const day = getDaySetting(date, wochenstunden);
  if (!day) return 0;
  return dayNetMinutes(day) / 60;
}

/**
 * Identisch mit getNormalWorkingHours (kein ePower Freitags-Überstunden-Konzept).
 */
export function getTotalWorkingHours(date: Date, wochenstunden: number = 40): number {
  return getNormalWorkingHours(date, wochenstunden);
}

/**
 * Gibt das Wochensoll zurück.
 */
export function getWeeklyTargetHours(wochenstunden: number = 40): number {
  return wochenstunden;
}

export interface WorkTimePreset {
  startTime: string;
  endTime: string;
  pauseVormittagMinutes: number;
  pauseMittagMinutes: number;
  pauseMinutes: number; // Summe beider Pausen
  totalHours: number; // netto
}

/**
 * Gibt die Regelarbeitszeit für einen Tag zurück (für Formular-Vorbelegung).
 * Freie Tage und flexible Modelle: null
 */
export function getDefaultWorkTimes(date: Date, wochenstunden: number = 40): WorkTimePreset | null {
  const dayOfWeek = date.getDay();

  // Wochenende
  if (dayOfWeek === 0 || dayOfWeek === 6) return null;

  // Flexible Modelle
  if (isFlexibleModel(wochenstunden)) return null;

  // 32h: Mittwoch frei
  if (wochenstunden === 32 && dayOfWeek === 3) return null;

  const day = getDaySetting(date, wochenstunden);
  if (!day || dayNetMinutes(day) === 0) return null;

  return {
    startTime: day.start,
    endTime: day.end,
    pauseVormittagMinutes: day.pauseVormittag,
    pauseMittagMinutes: day.pauseMittag,
    pauseMinutes: day.pauseVormittag + day.pauseMittag,
    totalHours: dayNetMinutes(day) / 60,
  };
}

/**
 * Gibt die Standard-Startzeit für das Modell zurück (Montag als Referenztag).
 * 20h/10h: "" (flexibel)
 */
export function getDefaultStartTime(wochenstunden: number = 40): string {
  if (isFlexibleModel(wochenstunden)) return "";
  return getModelWeek(wochenstunden)[1]?.start ?? DEFAULT_DAY.start;
}

/**
 * Gibt den Label-Text für ein Arbeitszeitmodell zurück.
 */
export function getWorkModelLabel(wochenstunden: number): string {
  switch (wochenstunden) {
    case 40: return "40 Std. – Vollzeit";
    case 38.5: return "38,5 Std. – Vollzeit";
    case 32: return "32 Std. – Teilzeit (Mi frei)";
    case 20: return "20 Std. – Teilzeit (flexibel)";
    case 10: return "10 Std. – Geringfügig (flexibel)";
    default: return `${formatModelHours(wochenstunden)} Std.`;
  }
}

/** Formatiert Minuten als "H:MM" (z.B. 195 -> "3:15"). */
export function formatMinutesAsHours(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const abs = Math.abs(minutes);
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
}
