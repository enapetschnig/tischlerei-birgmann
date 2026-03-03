export interface WorkTimePreset {
  startTime: string;
  endTime: string;
  pauseStart: string;
  pauseEnd: string;
  pauseMinutes: number;
  totalHours: number;
}

/**
 * Gibt zurück ob der Wochentag für dieses Arbeitszeitmodell ein freier Tag ist.
 * 32h-Modell: Mittwoch ist frei.
 */
export function isFreierTag(date: Date, wochenstunden: number = 40): boolean {
  const dayOfWeek = date.getDay();
  if (wochenstunden === 32 && dayOfWeek === 3) return true; // Mittwoch
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
 * Gibt die Sollstunden für einen bestimmten Tag zurück.
 * 40h: Mo–Fr = 8h
 * 32h: Mo/Di/Do/Fr = 8h, Mi = 0h (frei)
 * 20h/10h: immer 0h (flexibel, kein festes Tagesziel)
 */
export function getNormalWorkingHours(date: Date, wochenstunden: number = 40): number {
  const dayOfWeek = date.getDay();

  // Wochenende: immer 0
  if (dayOfWeek === 0 || dayOfWeek === 6) return 0;

  // Flexible Modelle (20h / 10h): kein festes Tagesziel
  if (wochenstunden === 20 || wochenstunden === 10) return 0;

  // 32h-Modell: Mittwoch frei
  if (wochenstunden === 32 && dayOfWeek === 3) return 0;

  // 40h und 32h an Arbeitstagen: 8h netto (= 9h Bruttozeit mit 1h Mittagspause)
  return 8;
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

/**
 * Gibt die Standard-Arbeitszeiten für einen Tag zurück (für Formular-Vorbelegung).
 * 40h/32h an Arbeitstagen: 06:30–15:30, Pause 12:00–13:00 (60 min)
 * Freie Tage und flexible Modelle: null
 */
export function getDefaultWorkTimes(date: Date, wochenstunden: number = 40): WorkTimePreset | null {
  const dayOfWeek = date.getDay();

  // Wochenende
  if (dayOfWeek === 0 || dayOfWeek === 6) return null;

  // Flexible Modelle
  if (wochenstunden === 20 || wochenstunden === 10) return null;

  // 32h: Mittwoch frei
  if (wochenstunden === 32 && dayOfWeek === 3) return null;

  // Arbeitstag (40h Mo–Fr, 32h Mo/Di/Do/Fr): 06:30–15:30, 1h Mittagspause
  return {
    startTime: "06:30",
    endTime: "15:30",
    pauseStart: "12:00",
    pauseEnd: "13:00",
    pauseMinutes: 60,
    totalHours: 8,
  };
}

/**
 * Gibt die Standard-Startzeit für das Modell zurück.
 * 40h/32h: "06:30"
 * 20h/10h: "" (flexibel)
 */
export function getDefaultStartTime(wochenstunden: number = 40): string {
  if (wochenstunden === 40 || wochenstunden === 32) return "06:30";
  return "";
}

/**
 * Gibt den Label-Text für ein Arbeitszeitmodell zurück.
 */
export function getWorkModelLabel(wochenstunden: number): string {
  switch (wochenstunden) {
    case 40: return "40 Std. – Vollzeit (Mo–Fr)";
    case 32: return "32 Std. – Teilzeit (Mi frei)";
    case 20: return "20 Std. – Teilzeit (flexibel)";
    case 10: return "10 Std. – Geringfügig (flexibel)";
    default: return `${wochenstunden} Std.`;
  }
}
