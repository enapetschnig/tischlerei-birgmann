import { useEffect, useMemo, useState } from "react";
import { eachDayOfInterval, format } from "date-fns";
import { de } from "date-fns/locale";
import { CalendarPlus, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { getDefaultWorkTimes, getNormalWorkingHours, loadWorkTimeSettings } from "@/lib/workingHours";
import { notifyUser } from "@/lib/notifications";

type Profile = {
  id: string;
  vorname: string;
  nachname: string;
};

type AbsenceType = "Urlaub" | "Krankenstand" | "Weiterbildung" | "Feiertag";

const ABSENCE_TYPES: { value: AbsenceType; label: string }[] = [
  { value: "Urlaub", label: "🏖️ Urlaub" },
  { value: "Krankenstand", label: "🏥 Krankenstand" },
  { value: "Weiterbildung", label: "📚 Weiterbildung" },
  { value: "Feiertag", label: "🎉 Feiertag" },
];

const MAX_DAYS = 62;

const toLocalDate = (iso: string) => new Date(iso + "T00:00:00");

interface AdminAbsenceEntryProps {
  profiles: Profile[];
  /** Wird nach erfolgreichem Eintragen aufgerufen (z.B. Kontingent neu laden). */
  onSaved?: () => void;
}

/**
 * Admin trägt Abwesenheiten (Urlaub, Krankenstand, …) für einen Mitarbeiter
 * über einen Zeitraum ein. Wochenenden, modellbedingt freie Tage und Tage mit
 * bestehenden Einträgen werden übersprungen. Ein Eintrag je Arbeitstag, mit
 * denselben Feldern wie der Abwesenheits-Dialog in der Zeiterfassung.
 */
export default function AdminAbsenceEntry({ profiles, onSaved }: AdminAbsenceEntryProps) {
  const { toast } = useToast();
  const today = new Date().toISOString().split("T")[0];

  const [userId, setUserId] = useState("");
  const [type, setType] = useState<AbsenceType>("Urlaub");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [wochenstunden, setWochenstunden] = useState<Record<string, number>>({});
  const [settingsReady, setSettingsReady] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      await loadWorkTimeSettings();
      const { data } = await supabase.from("employees").select("user_id, wochenstunden");
      const map: Record<string, number> = {};
      (data || []).forEach((e) => {
        if (e.user_id) map[e.user_id] = e.wochenstunden || 40;
      });
      setWochenstunden(map);
      setSettingsReady(true);
    };
    load();
  }, []);

  // Bis darf nicht vor Von liegen
  useEffect(() => {
    if (from && to && to < from) setTo(from);
  }, [from, to]);

  const ws = wochenstunden[userId] || 40;
  const isFlexible = ws === 20 || ws === 10;

  /** Vorschau: welche Tage im Zeitraum sind Arbeitstage? */
  const preview = useMemo(() => {
    if (!from || !to || to < from || !settingsReady) return null;
    const days = eachDayOfInterval({ start: toLocalDate(from), end: toLocalDate(to) });
    if (days.length > MAX_DAYS) return { tooMany: true, working: [] as Date[], free: 0 };
    const working = days.filter((d) => getNormalWorkingHours(d, ws) > 0);
    return { tooMany: false, working, free: days.length - working.length };
  }, [from, to, ws, settingsReady]);

  const handleSubmit = async () => {
    if (saving) return;
    if (!userId) {
      toast({ variant: "destructive", title: "Fehler", description: "Bitte einen Mitarbeiter auswählen." });
      return;
    }
    if (!preview || preview.tooMany) {
      toast({ variant: "destructive", title: "Fehler", description: `Zeitraum ungültig oder länger als ${MAX_DAYS} Tage.` });
      return;
    }
    if (preview.working.length === 0) {
      toast({
        variant: "destructive",
        title: "Keine Arbeitstage im Zeitraum",
        description: isFlexible
          ? "Für flexible Modelle (20h/10h) gibt es kein Tagessoll — bitte über die Zeiterfassung mit Stundenangabe eintragen."
          : "Im gewählten Zeitraum liegen nur Wochenenden oder freie Tage.",
      });
      return;
    }

    setSaving(true);

    // Tage, an denen schon etwas gebucht ist, nicht überschreiben
    const { data: existing, error: existErr } = await supabase
      .from("time_entries")
      .select("datum")
      .eq("user_id", userId)
      .gte("datum", from)
      .lte("datum", to);

    if (existErr) {
      toast({ variant: "destructive", title: "Fehler", description: "Bestehende Einträge konnten nicht geprüft werden." });
      setSaving(false);
      return;
    }

    const booked = new Set((existing || []).map((e) => e.datum));
    const toBook = preview.working.filter((d) => !booked.has(format(d, "yyyy-MM-dd")));
    const skipped = preview.working.length - toBook.length;

    if (toBook.length === 0) {
      toast({
        variant: "destructive",
        title: "Nichts eingetragen",
        description: "An allen Arbeitstagen im Zeitraum gibt es bereits Einträge.",
      });
      setSaving(false);
      return;
    }

    const rows = toBook.map((d) => {
      const defaults = getDefaultWorkTimes(d, ws);
      return {
        user_id: userId,
        datum: format(d, "yyyy-MM-dd"),
        project_id: null,
        taetigkeit: type,
        stunden: getNormalWorkingHours(d, ws),
        start_time: defaults?.startTime || "06:30",
        end_time: defaults?.endTime || "15:30",
        pause_minutes: defaults?.pauseMinutes ?? 60,
        location_type: "baustelle",
        notizen: null,
        week_type: null,
      };
    });

    const { error } = await supabase.from("time_entries").insert(rows);

    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: `Konnte nicht gespeichert werden: ${error.message}` });
      setSaving(false);
      return;
    }

    const first = format(toBook[0], "dd.MM.", { locale: de });
    const last = format(toBook[toBook.length - 1], "dd.MM.yyyy", { locale: de });
    const range = toBook.length === 1 ? last : `${first} – ${last}`;

    // Den Mitarbeiter informieren (Glocke)
    await notifyUser(
      userId,
      "abwesenheit",
      `${type} eingetragen`,
      `${range}: ${type} wurde für dich eingetragen (${toBook.length} ${toBook.length === 1 ? "Tag" : "Tage"}).`
    );

    toast({
      title: `${type} eingetragen`,
      description:
        `${toBook.length} ${toBook.length === 1 ? "Tag" : "Tage"} (${range})` +
        (skipped > 0 ? ` · ${skipped} übersprungen, dort war schon etwas gebucht` : ""),
    });

    setSaving(false);
    onSaved?.();
  };

  const selectedProfile = profiles.find((p) => p.id === userId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarPlus className="h-5 w-5" />
          Abwesenheit eintragen
        </CardTitle>
        <CardDescription>
          Urlaub, Krankenstand, Weiterbildung oder Feiertag für einen Mitarbeiter über einen Zeitraum
          eintragen. Wochenenden und freie Tage werden automatisch übersprungen.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Mitarbeiter</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger>
                <SelectValue placeholder="Mitarbeiter auswählen" />
              </SelectTrigger>
              <SelectContent>
                {profiles
                  .filter((p) => p.vorname && p.nachname)
                  .map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.vorname} {p.nachname}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Art</Label>
            <Select value={type} onValueChange={(v) => setType(v as AbsenceType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ABSENCE_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Von</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Bis</Label>
            <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>

        {/* Vorschau */}
        {preview && (
          <div className="rounded-lg bg-muted/50 p-3 text-sm">
            {preview.tooMany ? (
              <span className="text-destructive">Zeitraum ist länger als {MAX_DAYS} Tage.</span>
            ) : preview.working.length === 0 ? (
              <span className="text-muted-foreground">
                {isFlexible && userId
                  ? "Flexibles Arbeitszeitmodell — kein Tagessoll, bitte über die Zeiterfassung eintragen."
                  : "Keine Arbeitstage im Zeitraum."}
              </span>
            ) : (
              <>
                <strong>{preview.working.length}</strong> {preview.working.length === 1 ? "Arbeitstag" : "Arbeitstage"}
                {selectedProfile && (
                  <> für <strong>{selectedProfile.vorname} {selectedProfile.nachname}</strong></>
                )}
                {preview.free > 0 && (
                  <span className="text-muted-foreground"> · {preview.free} freie Tage übersprungen</span>
                )}
                <span className="text-muted-foreground">
                  {" "}· je {getNormalWorkingHours(preview.working[0], ws)} h
                </span>
              </>
            )}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Zeitausgleich (ZA) weiterhin über die Zeiterfassung eintragen — dort wird das Zeitkonto abgebucht.
        </p>

        <Button onClick={handleSubmit} disabled={saving || !settingsReady} className="w-full sm:w-auto">
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Wird eingetragen…
            </>
          ) : (
            <>
              <CalendarPlus className="h-4 w-4 mr-2" />
              Eintragen
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
