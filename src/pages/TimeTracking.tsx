import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Clock, Plus, AlertTriangle, CheckCircle2, Calendar, Sun, Trash2, Users, ArrowLeft, FolderOpen } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/PageHeader";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { toast as sonnerToast } from "sonner";
import {
  getNormalWorkingHours,
  getDefaultWorkTimes,
  getWeeklyTargetHours,
  loadWorkTimeSettings,
  timeToMinutes,
  minutesToTime,
  formatMinutesAsHours,
} from "@/lib/workingHours";
import { notifyAdmins } from "@/lib/notifications";
import { FillRemainingHoursDialog } from "@/components/FillRemainingHoursDialog";

type Project = {
  id: string;
  name: string;
  status: string;
  plz: string;
};

export type Subfolder = {
  id: string;
  project_id: string;
  name: string;
};

type ExistingEntry = {
  id: string;
  start_time: string;
  end_time: string;
  stunden: number;
  taetigkeit: string;
  project_name: string | null;
  subfolder_name: string | null;
  plz: string | null;
};

/** Eine Projektzeit-Zeile: Dauer in Stunden + Minuten (15er-Schritte, Rest minutengenau). */
interface Allocation {
  id: string;
  locationType: "baustelle" | "werkstatt";
  projectId: string;
  subfolderId: string;
  taetigkeit: string;
  hours: string; // "0".."12"
  minutes: string; // "0" | "15" | "30" | "45" | Restwert
}

const createAllocation = (): Allocation => ({
  id: crypto.randomUUID(),
  locationType: "baustelle",
  projectId: "",
  subfolderId: "",
  taetigkeit: "",
  hours: "0",
  minutes: "0",
});

const HOUR_OPTIONS = Array.from({ length: 13 }, (_, i) => String(i)); // 0-12
const QUARTER_OPTIONS = ["0", "15", "30", "45"];
const pauseOptions = (max: number) => Array.from({ length: max + 1 }, (_, i) => String(i)); // minütlich

const TimeTracking = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Admin editing mode: when admin navigates here from HoursReport with user_id param
  const adminEditUserId = searchParams.get("user_id");
  const adminEditDate = searchParams.get("date");
  const returnMonth = searchParams.get("return_month");
  const returnYear = searchParams.get("return_year");
  const returnEmployee = searchParams.get("return_employee");
  const isAdminEditMode = !!adminEditUserId;

  const [adminEditUserName, setAdminEditUserName] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  const [projects, setProjects] = useState<Project[]>([]);
  const [subfolders, setSubfolders] = useState<Subfolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [creatingSubfolder, setCreatingSubfolder] = useState(false);
  const [submittingAbsence, setSubmittingAbsence] = useState(false);
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectPlz, setNewProjectPlz] = useState("");
  const [newProjectAddress, setNewProjectAddress] = useState("");
  const [pendingAllocForNewProject, setPendingAllocForNewProject] = useState<string | null>(null);

  const [showNewSubfolderDialog, setShowNewSubfolderDialog] = useState(false);
  const [newSubfolderName, setNewSubfolderName] = useState("");
  const [pendingAllocForNewSubfolder, setPendingAllocForNewSubfolder] = useState<string | null>(null);

  const [existingDayEntries, setExistingDayEntries] = useState<ExistingEntry[]>([]);
  const [loadingDayEntries, setLoadingDayEntries] = useState(false);
  const [showFillDialog, setShowFillDialog] = useState(false);
  const [employeeWochenstunden, setEmployeeWochenstunden] = useState(40);

  const [showAbsenceDialog, setShowAbsenceDialog] = useState(false);

  const [absenceData, setAbsenceData] = useState({
    date: new Date().toISOString().split('T')[0],
    type: "urlaub" as "urlaub" | "krankenstand" | "weiterbildung" | "feiertag" | "za",
    document: null as File | null,
    customHours: "" as string,
    isFullDay: true,
    absenceStartTime: "06:30",
    absenceEndTime: "15:30",
    absencePauseMinutes: "60",
  });

  const [selectedDate, setSelectedDate] = useState(adminEditDate || new Date().toISOString().split('T')[0]);

  // Tagesrahmen: Arbeitszeit von/bis + Pausen als Minuten (Vormittag/Mittag)
  const [dayStart, setDayStart] = useState("");
  const [dayEnd, setDayEnd] = useState("");
  const [pauseVormittag, setPauseVormittag] = useState("0");
  const [pauseMittag, setPauseMittag] = useState("0");

  const [allocations, setAllocations] = useState<Allocation[]>([createAllocation()]);

  // ----- Abgeleitete Werte -----
  const grossMinutes = dayStart && dayEnd
    ? Math.max(0, timeToMinutes(dayEnd) - timeToMinutes(dayStart))
    : 0;
  const pauseTotalMinutes = (parseInt(pauseVormittag) || 0) + (parseInt(pauseMittag) || 0);
  const netMinutes = Math.max(0, grossMinutes - pauseTotalMinutes);

  const allocationMinutes = (a: Allocation): number =>
    (parseInt(a.hours) || 0) * 60 + (parseInt(a.minutes) || 0);
  const totalAllocatedMinutes = allocations.reduce((sum, a) => sum + allocationMinutes(a), 0);
  const restMinutes = netMinutes - totalAllocatedMinutes;

  // ----- Vorbelegung mit Regelarbeitszeit -----
  const applyDefaultsToFrame = (dateStr: string, wochenstunden: number) => {
    const defaults = getDefaultWorkTimes(new Date(dateStr), wochenstunden);
    if (defaults) {
      setDayStart(defaults.startTime);
      setDayEnd(defaults.endTime);
      setPauseVormittag(String(defaults.pauseVormittagMinutes));
      setPauseMittag(String(defaults.pauseMittagMinutes));
    } else {
      setDayStart("");
      setDayEnd("");
      setPauseVormittag("0");
      setPauseMittag("0");
    }
  };

  // Fetch existing entries for selected date
  const fetchExistingDayEntries = async (date: string) => {
    setLoadingDayEntries(true);
    await loadWorkTimeSettings();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoadingDayEntries(false);
      return;
    }

    const targetUserId = (isAdminEditMode && isAdmin) ? adminEditUserId : user.id;

    const { data, error } = await supabase
      .from("time_entries")
      .select(`
        id,
        start_time,
        end_time,
        stunden,
        taetigkeit,
        projects (name, plz),
        project_subfolders (name)
      `)
      .eq("user_id", targetUserId)
      .eq("datum", date)
      .order("start_time");

    if (!error && data) {
      const entries: ExistingEntry[] = data.map((entry: any) => ({
        id: entry.id,
        start_time: entry.start_time,
        end_time: entry.end_time,
        stunden: entry.stunden,
        taetigkeit: entry.taetigkeit,
        project_name: entry.projects?.name || null,
        subfolder_name: entry.project_subfolders?.name || null,
        plz: entry.projects?.plz || null,
      }));
      setExistingDayEntries(entries);

      const dayIsBlocked = entries.some(e => ["Urlaub", "Krankenstand", "Weiterbildung", "Feiertag", "Zeitausgleich"].includes(e.taetigkeit));
      if (entries.length > 0 && !dayIsBlocked) {
        // Es gibt schon Einträge: Rahmen ab letztem Ende vorschlagen
        const lastEntry = entries[entries.length - 1];
        const suggestedStart = minutesToTime(timeToMinutes(lastEntry.end_time.substring(0, 5)) + 30);
        setDayStart(suggestedStart);
        setDayEnd("");
        setPauseVormittag("0");
        setPauseMittag("0");
        setAllocations([createAllocation()]);
      } else if (!dayIsBlocked) {
        applyDefaultsToFrame(date, employeeWochenstunden);
        setAllocations([createAllocation()]);
      }
    } else {
      setExistingDayEntries([]);
      applyDefaultsToFrame(date, employeeWochenstunden);
      setAllocations([createAllocation()]);
    }
    setLoadingDayEntries(false);
  };

  const handleDeleteExistingEntry = async (entryId: string) => {
    const { error } = await supabase.from("time_entries").delete().eq("id", entryId);
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: "Eintrag konnte nicht gelöscht werden" });
    } else {
      toast({ title: "Gelöscht", description: "Eintrag wurde entfernt" });
      fetchExistingDayEntries(selectedDate);
    }
  };

  // Load existing entries when date (or work model) changes
  useEffect(() => {
    fetchExistingDayEntries(selectedDate);
  }, [selectedDate, employeeWochenstunden]);

  // Check admin status and load target user name for admin edit mode
  useEffect(() => {
    const checkAdmin = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", user.id).single();
      setIsAdmin(data?.role === "administrator");
      if (adminEditUserId && data?.role === "administrator") {
        const { data: profile } = await supabase.from("profiles").select("vorname, nachname").eq("id", adminEditUserId).single();
        if (profile) setAdminEditUserName(`${profile.vorname} ${profile.nachname}`.trim());
      }
      // Load work model for remaining hours calculation
      const targetUserId = (adminEditUserId && data?.role === "administrator") ? adminEditUserId : user.id;
      const { data: empData } = await supabase
        .from("employees")
        .select("wochenstunden")
        .eq("user_id", targetUserId)
        .maybeSingle();
      setEmployeeWochenstunden(empData?.wochenstunden || 40);
    };
    checkAdmin();
  }, [adminEditUserId]);

  useEffect(() => {
    fetchProjects();
    fetchSubfolders();

    const channel = supabase
      .channel('projects-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, () => {
        fetchProjects();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchProjects = async () => {
    const { data } = await supabase
      .from("projects")
      .select("id, name, status, plz")
      .eq("status", "aktiv")
      .order("name");

    if (data) setProjects(data);
    setLoading(false);
  };

  const fetchSubfolders = async () => {
    const { data } = await supabase
      .from("project_subfolders")
      .select("id, project_id, name")
      .order("name");
    if (data) setSubfolders(data);
  };

  const handleCreateNewProject = async () => {
    if (creatingProject) return;

    if (!newProjectName.trim() || !newProjectPlz.trim()) {
      sonnerToast.error("Name und PLZ sind Pflichtfelder");
      return;
    }

    if (!/^\d{4,5}$/.test(newProjectPlz)) {
      sonnerToast.error("PLZ muss 4-5 Ziffern haben");
      return;
    }

    setCreatingProject(true);

    const { data, error } = await supabase
      .from('projects')
      .insert({
        name: newProjectName.trim(),
        plz: newProjectPlz.trim(),
        adresse: newProjectAddress.trim() || null,
        status: 'aktiv'
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        sonnerToast.error("Ein Projekt mit diesem Namen und PLZ existiert bereits");
      } else {
        sonnerToast.error("Projekt konnte nicht erstellt werden");
      }
      setCreatingProject(false);
      return;
    }

    sonnerToast.success("Projekt erfolgreich erstellt");

    if (pendingAllocForNewProject) {
      updateAllocation(pendingAllocForNewProject, { projectId: data.id, subfolderId: "" });
    }

    setShowNewProjectDialog(false);
    setNewProjectName("");
    setNewProjectPlz("");
    setNewProjectAddress("");
    setPendingAllocForNewProject(null);
    setCreatingProject(false);
  };

  const handleCreateNewSubfolder = async () => {
    if (creatingSubfolder) return;
    const alloc = allocations.find(a => a.id === pendingAllocForNewSubfolder);
    if (!alloc?.projectId) return;
    if (!newSubfolderName.trim()) {
      sonnerToast.error("Bitte einen Namen eingeben");
      return;
    }

    setCreatingSubfolder(true);
    const { data, error } = await supabase
      .from("project_subfolders")
      .insert({ project_id: alloc.projectId, name: newSubfolderName.trim() })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        sonnerToast.error("Diesen Unterordner gibt es bereits");
      } else {
        sonnerToast.error("Unterordner konnte nicht erstellt werden");
      }
      setCreatingSubfolder(false);
      return;
    }

    await fetchSubfolders();
    if (pendingAllocForNewSubfolder) {
      updateAllocation(pendingAllocForNewSubfolder, { subfolderId: data.id });
    }
    sonnerToast.success("Unterordner erstellt");
    setShowNewSubfolderDialog(false);
    setNewSubfolderName("");
    setPendingAllocForNewSubfolder(null);
    setCreatingSubfolder(false);
  };

  // Update a specific allocation
  const updateAllocation = (allocId: string, updates: Partial<Allocation>) => {
    setAllocations(prev => prev.map(a =>
      a.id === allocId ? { ...a, ...updates } : a
    ));
  };

  const addAllocation = () => {
    setAllocations(prev => [...prev, createAllocation()]);
  };

  const removeAllocation = (allocId: string) => {
    setAllocations(prev => prev.filter(a => a.id !== allocId));
  };

  /** "Rest übernehmen": setzt die Dauer dieser Zeile so, dass der Tag voll verteilt ist. */
  const applyRestToAllocation = (allocId: string) => {
    const alloc = allocations.find(a => a.id === allocId);
    if (!alloc) return;
    const newTotal = allocationMinutes(alloc) + restMinutes;
    if (newTotal <= 0) return;
    updateAllocation(allocId, {
      hours: String(Math.floor(newTotal / 60)),
      minutes: String(newTotal % 60),
    });
  };

  const applyFullDayPreset = () => {
    const defaults = getDefaultWorkTimes(new Date(selectedDate), employeeWochenstunden);
    if (!defaults) {
      toast({
        variant: "destructive",
        title: "Arbeitsfrei",
        description: "Für diesen Tag ist keine Regelarbeitszeit hinterlegt"
      });
      return;
    }
    setDayStart(defaults.startTime);
    setDayEnd(defaults.endTime);
    setPauseVormittag(String(defaults.pauseVormittagMinutes));
    setPauseMittag(String(defaults.pauseMittagMinutes));
  };

  const handleAbsenceSubmit = async () => {
    if (submittingAbsence) return;

    setSubmittingAbsence(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast({ variant: "destructive", title: "Fehler", description: "Sie müssen angemeldet sein" });
      setSubmittingAbsence(false);
      return;
    }

    // Im Admin-Bearbeiten-Modus wird die Abwesenheit für den Ziel-Mitarbeiter gebucht, nicht für den Admin
    const targetUserId = (isAdminEditMode && isAdmin) ? adminEditUserId! : user.id;

    const { count: existingCount } = await supabase
      .from("time_entries")
      .select("id", { count: "exact", head: true })
      .eq("user_id", targetUserId)
      .eq("datum", absenceData.date);

    if ((existingCount ?? 0) > 0) {
      toast({
        variant: "destructive",
        title: "Eintrag bereits vorhanden",
        description: "Für diesen Tag wurden die Stunden bereits eingetragen, gehe unter Meine Stunden rein."
      });
      setSubmittingAbsence(false);
      return;
    }

    let documentPath = null;
    if (absenceData.type === "krankenstand" && absenceData.document) {
      const fileName = `${targetUserId}/${Date.now()}_${absenceData.document.name}`;
      const { error: uploadError } = await supabase.storage
        .from("employee-documents")
        .upload(fileName, absenceData.document);

      if (uploadError) {
        toast({ variant: "destructive", title: "Fehler", description: `Dokument konnte nicht hochgeladen werden: ${uploadError.message}` });
        setSubmittingAbsence(false);
        return;
      }

      documentPath = fileName;
    }

    const selectedDateObj = new Date(absenceData.date);
    const automaticHours = getNormalWorkingHours(selectedDateObj, employeeWochenstunden);
    const defaultTimes = getDefaultWorkTimes(selectedDateObj, employeeWochenstunden);

    let workingHours: number;
    let entryStartTime: string;
    let entryEndTime: string;
    let entryPauseMinutes: number;

    if (absenceData.isFullDay) {
      workingHours = absenceData.customHours ? parseFloat(absenceData.customHours) : automaticHours;
      entryStartTime = defaultTimes?.startTime || "06:30";
      entryEndTime = defaultTimes?.endTime || "15:30";
      entryPauseMinutes = defaultTimes?.pauseMinutes || 60;
    } else {
      // Calculate from Von/Bis
      const [sH, sM] = absenceData.absenceStartTime.split(':').map(Number);
      const [eH, eM] = absenceData.absenceEndTime.split(':').map(Number);
      const pause = parseInt(absenceData.absencePauseMinutes) || 0;
      const totalMinutes = (eH * 60 + eM) - (sH * 60 + sM) - pause;
      workingHours = Math.max(0, totalMinutes / 60);
      entryStartTime = absenceData.absenceStartTime;
      entryEndTime = absenceData.absenceEndTime;
      entryPauseMinutes = pause;
    }

    // ZA: Check and deduct from time account
    if (absenceData.type === "za") {
      const { data: timeAccount, error: taError } = await supabase
        .from("time_accounts")
        .select("id, balance_hours")
        .eq("user_id", targetUserId)
        .maybeSingle();

      if (taError || !timeAccount) {
        toast({ variant: "destructive", title: "Fehler", description: "Kein Zeitkonto gefunden. Bitte wenden Sie sich an den Administrator." });
        setSubmittingAbsence(false);
        return;
      }

      if (Number(timeAccount.balance_hours) < workingHours) {
        toast({ variant: "destructive", title: "Nicht genügend ZA-Stunden", description: `Verfügbar: ${timeAccount.balance_hours}h, benötigt: ${workingHours}h` });
        setSubmittingAbsence(false);
        return;
      }

      const balanceBefore = Number(timeAccount.balance_hours);
      const balanceAfter = balanceBefore - workingHours;

      const { error: updateErr } = await supabase
        .from("time_accounts")
        .update({ balance_hours: balanceAfter, updated_at: new Date().toISOString() })
        .eq("id", timeAccount.id);

      if (updateErr) {
        toast({ variant: "destructive", title: "Fehler", description: "ZA-Stunden konnten nicht abgebucht werden" });
        setSubmittingAbsence(false);
        return;
      }

      await supabase.from("time_account_transactions").insert({
        user_id: targetUserId,
        changed_by: user.id,
        change_type: "za_abzug",
        hours: -workingHours,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        reason: `Zeitausgleich am ${absenceData.date}`,
      });
    }

    const absenceLabel = absenceData.type === "urlaub" ? "Urlaub" : absenceData.type === "krankenstand" ? "Krankenstand" : absenceData.type === "weiterbildung" ? "Weiterbildung" : absenceData.type === "za" ? "Zeitausgleich" : "Feiertag";

    const { error } = await supabase.from("time_entries").insert({
      user_id: targetUserId,
      datum: absenceData.date,
      project_id: null,
      taetigkeit: absenceLabel,
      stunden: workingHours,
      start_time: entryStartTime,
      end_time: entryEndTime,
      pause_minutes: entryPauseMinutes,
      location_type: "baustelle",
      notizen: documentPath ? `Krankmeldung: ${documentPath}` : null,
      week_type: null,
    });

    if (!error) {
      toast({ title: "Erfolg", description: `${absenceLabel} erfasst` });

      // Notify admins for vacation and sick leave
      if (absenceData.type === "urlaub" || absenceData.type === "krankenstand") {
        const { data: profileData } = await supabase
          .from("profiles")
          .select("vorname, nachname")
          .eq("id", targetUserId)
          .maybeSingle();
        const name = profileData ? `${profileData.vorname} ${profileData.nachname}`.trim() : "Ein Mitarbeiter";
        if (absenceData.type === "urlaub") {
          notifyAdmins("leave_request", "Neuer Urlaubsantrag", `${name} hat am ${absenceData.date} Urlaub eingetragen.`);
        } else {
          notifyAdmins("krankmeldung", "Neue Krankmeldung", `${name} hat am ${absenceData.date} Krankenstand eingetragen.`);
        }
      }

      setShowAbsenceDialog(false);
      setAbsenceData({
        date: new Date().toISOString().split('T')[0],
        type: "urlaub",
        document: null,
        customHours: "",
        isFullDay: true,
        absenceStartTime: "07:00",
        absenceEndTime: "16:00",
        absencePauseMinutes: "30",
      });
      fetchExistingDayEntries(selectedDate);
    } else {
      toast({ variant: "destructive", title: "Fehler", description: "Konnte nicht gespeichert werden" });
    }
    setSubmittingAbsence(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast({ variant: "destructive", title: "Fehler", description: "Sie müssen angemeldet sein" });
      setSaving(false);
      return;
    }

    const submitUserId = (isAdminEditMode && isAdmin) ? adminEditUserId! : user.id;

    // Rahmen validieren
    if (!dayStart || !dayEnd) {
      toast({ variant: "destructive", title: "Fehler", description: "Arbeitszeit Beginn und Ende erforderlich" });
      setSaving(false);
      return;
    }
    if (timeToMinutes(dayEnd) <= timeToMinutes(dayStart)) {
      toast({ variant: "destructive", title: "Fehler", description: "Ende muss nach Beginn liegen" });
      setSaving(false);
      return;
    }
    if (netMinutes <= 0) {
      toast({ variant: "destructive", title: "Fehler", description: "Pausen sind länger als die Arbeitszeit" });
      setSaving(false);
      return;
    }

    // Projektzeiten validieren: alles verteilt, keine leeren Zeilen
    if (allocations.some(a => allocationMinutes(a) <= 0)) {
      toast({ variant: "destructive", title: "Fehler", description: "Jede Projektzeit braucht eine Dauer (oder Zeile löschen)" });
      setSaving(false);
      return;
    }
    if (restMinutes !== 0) {
      toast({
        variant: "destructive",
        title: restMinutes > 0 ? "Zeit nicht vollständig verteilt" : "Zu viel verteilt",
        description: restMinutes > 0
          ? `Noch ${formatMinutesAsHours(restMinutes)} h offen – nutze "Rest übernehmen"`
          : `${formatMinutesAsHours(-restMinutes)} h zu viel – Projektzeiten kürzen`
      });
      setSaving(false);
      return;
    }

    // Check if day is blocked (Urlaub, Krankenstand, etc.) using local state
    if (isDayBlocked) {
      const blockedEntry = existingDayEntries.find(e => ["Urlaub", "Krankenstand", "Weiterbildung", "Feiertag", "Zeitausgleich"].includes(e.taetigkeit));
      toast({
        variant: "destructive",
        title: "Tag bereits blockiert",
        description: `Für diesen Tag ist bereits ${blockedEntry?.taetigkeit} eingetragen.`
      });
      setSaving(false);
      return;
    }

    // Projektzeiten nacheinander auf die Uhrzeit-Achse legen.
    // Die Pausen (Vormittag + Mittag) werden dem ersten Eintrag zugeordnet,
    // damit Beginn/Ende des Tages exakt stimmen.
    const pauseVM = parseInt(pauseVormittag) || 0;
    const pauseMI = parseInt(pauseMittag) || 0;
    let cursor = timeToMinutes(dayStart);
    let totalEntriesCreated = 0;
    let hasError = false;

    for (let i = 0; i < allocations.length; i++) {
      const alloc = allocations[i];
      const durMinutes = allocationMinutes(alloc);
      const extraPause = i === 0 ? pauseVM + pauseMI : 0;
      const startTime = minutesToTime(cursor);
      const endTime = minutesToTime(cursor + durMinutes + extraPause);
      cursor = cursor + durMinutes + extraPause;

      const mainEntry = {
        user_id: submitUserId,
        datum: selectedDate,
        project_id: alloc.projectId || null,
        subfolder_id: alloc.subfolderId || null,
        taetigkeit: alloc.taetigkeit,
        stunden: durMinutes / 60,
        start_time: startTime,
        end_time: endTime,
        pause_minutes: extraPause,
        pause_vormittag_minutes: i === 0 ? pauseVM : 0,
        pause_mittag_minutes: i === 0 ? pauseMI : 0,
        location_type: alloc.locationType,
        notizen: null,
        week_type: null,
      };

      const { data: result, error: functionError } = await supabase.functions.invoke(
        "create-team-time-entries",
        {
          body: {
            mainEntry,
            teamEntries: [],
            createWorkerLinks: false,
          },
        }
      );

      if (functionError || !result?.success) {
        hasError = true;
        console.error("Error creating time entries:", functionError || result?.error);
        continue;
      }

      totalEntriesCreated += result.totalCreated || 1;
    }

    if (!hasError) {
      toast({ title: "Erfolg", description: `${totalEntriesCreated} Eintrag/Einträge gespeichert` });

      // In admin edit mode, navigate back to hours report
      if (isAdminEditMode && returnMonth && returnYear) {
        setSaving(false);
        navigate(`/hours-report?employee=${returnEmployee || ""}&month=${returnMonth}&year=${returnYear}`);
        return;
      }

      // Refresh existing entries
      await fetchExistingDayEntries(selectedDate);
    } else {
      toast({ variant: "destructive", title: "Fehler", description: "Einige Einträge konnten nicht gespeichert werden" });
    }
    setSaving(false);
  };

  const isDayBlocked = existingDayEntries.some(e => ["Urlaub", "Krankenstand", "Weiterbildung", "Feiertag", "Zeitausgleich"].includes(e.taetigkeit));

  const handleFillHoursSubmit = async (
    projectId: string | null,
    subfolderId: string | null,
    locationType: string,
    description: string,
    startTime: string,
    endTime: string,
    pauseMinutes: number = 0
  ) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const targetUserId = (isAdminEditMode && isAdmin) ? adminEditUserId : user.id;

    const [sH, sM] = startTime.split(":").map(Number);
    const [eH, eM] = endTime.split(":").map(Number);
    const totalMinutes = (eH * 60 + eM) - (sH * 60 + sM) - pauseMinutes;
    const stunden = totalMinutes / 60;

    const mainEntry = {
      user_id: targetUserId,
      datum: selectedDate,
      project_id: projectId,
      subfolder_id: subfolderId,
      taetigkeit: "Arbeit",
      stunden,
      start_time: startTime,
      end_time: endTime,
      pause_minutes: pauseMinutes,
      location_type: locationType,
      notizen: description || null,
      week_type: null,
    };

    const { data: result, error } = await supabase.functions.invoke(
      "create-team-time-entries",
      { body: { mainEntry, teamEntries: [], createWorkerLinks: false } }
    );

    if (error || !result?.success) {
      toast({ variant: "destructive", title: "Fehler", description: "Reststunden konnten nicht gebucht werden" });
      return;
    }

    toast({ title: "Reststunden gebucht", description: `${stunden.toFixed(2)} h wurden erfolgreich gebucht` });
    setShowFillDialog(false);
    await fetchExistingDayEntries(selectedDate);
  };

  if (loading) return <div className="p-4">Lädt...</div>;

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title={isAdminEditMode ? `Zeiterfassung für ${adminEditUserName}` : "Zeiterfassung"} />

      <div className="p-4">
        {/* Admin edit mode banner */}
        {isAdminEditMode && adminEditUserName && (
          <div className="max-w-2xl mx-auto mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-amber-600" />
              <span className="text-sm font-medium text-amber-800">
                Du bearbeitest Einträge für <strong>{adminEditUserName}</strong>
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(`/hours-report?employee=${returnEmployee || ""}&month=${returnMonth || ""}&year=${returnYear || ""}`)}
              className="text-amber-700 hover:text-amber-900"
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Zurück
            </Button>
          </div>
        )}

        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                <CardTitle>{isAdminEditMode ? `Zeiterfassung – ${adminEditUserName}` : "Zeiterfassung"}</CardTitle>
              </div>
              <Button
                variant="outline"
                onClick={() => setShowAbsenceDialog(true)}
                className="gap-2"
              >
                <Calendar className="h-4 w-4" />
                Abwesenheit
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Date picker */}
              <div className="space-y-2">
                <Label htmlFor="date">Datum</Label>
                <Input
                  id="date"
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  required
                />
                {selectedDate && (
                  <p className="text-sm text-muted-foreground">
                    {format(new Date(selectedDate), "EEEE, dd. MMMM yyyy", { locale: de })}
                  </p>
                )}
              </div>

              {/* Weekly target info */}
              <div className="rounded-lg border bg-card p-4">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">
                    {getWeeklyTargetHours(employeeWochenstunden)}h Wochensoll
                  </Badge>
                </div>
              </div>

              {/* Existing entries info box */}
              {loadingDayEntries ? (
                <div className="bg-muted/50 rounded-lg p-3 text-sm text-muted-foreground flex items-center gap-2">
                  <Calendar className="w-4 h-4 animate-pulse" />
                  Lade Tageseinträge...
                </div>
              ) : existingDayEntries.length > 0 ? (
                <div className={`rounded-lg p-4 space-y-3 ${
                  isDayBlocked
                    ? "bg-destructive/10 border border-destructive/30"
                    : "bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800"
                }`}>
                  <div className="flex items-center gap-2 font-medium text-sm">
                    {isDayBlocked ? (
                      <>
                        <AlertTriangle className="w-4 h-4 text-destructive" />
                        <span className="text-destructive">Tag blockiert ({existingDayEntries[0].taetigkeit})</span>
                      </>
                    ) : (
                      <>
                        <Calendar className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                        <span className="text-amber-700 dark:text-amber-300">Bereits gebuchte Zeiten</span>
                      </>
                    )}
                  </div>

                  {!isDayBlocked && (
                    <div className="space-y-1.5">
                      {existingDayEntries.map((entry) => (
                        <div key={entry.id} className="flex items-center justify-between text-sm bg-background/60 rounded px-2 py-1.5">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="font-mono text-xs">
                              {entry.start_time.substring(0, 5)} - {entry.end_time.substring(0, 5)}
                            </Badge>
                            <span className="truncate max-w-[170px]">
                              {entry.project_name
                                ? `${entry.project_name}${entry.subfolder_name ? ` – ${entry.subfolder_name}` : ""}`
                                : entry.taetigkeit}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{Number(entry.stunden).toFixed(2)}h</span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-destructive hover:text-destructive"
                              onClick={() => handleDeleteExistingEntry(entry.id)}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-2 border-t border-amber-200 dark:border-amber-700">
                    <span className="text-sm font-medium">Tagessumme</span>
                    <span className="font-bold">
                      {existingDayEntries.reduce((sum, e) => sum + Number(e.stunden), 0).toFixed(2)} Stunden
                    </span>
                  </div>
                  {(() => {
                    const bookedTotal = existingDayEntries.reduce((sum, e) => sum + Number(e.stunden), 0);
                    const targetHours = getNormalWorkingHours(new Date(selectedDate + "T00:00:00"), employeeWochenstunden);
                    const remaining = targetHours - bookedTotal;
                    if (remaining <= 0.1 || targetHours <= 0) return null;
                    return (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full mt-2 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/30"
                        onClick={() => setShowFillDialog(true)}
                      >
                        <Clock className="w-4 h-4 mr-2" />
                        Reststunden auffüllen ({remaining.toFixed(2)} h)
                      </Button>
                    );
                  })()}
                </div>
              ) : (
                <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 text-sm text-muted-foreground">
                  <p className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    Noch keine Einträge für diesen Tag
                  </p>
                </div>
              )}

              {/* Only show form if day is not blocked */}
              {!isDayBlocked && (
                <>
                  {/* ===== 1) Arbeitszeit (Tagesrahmen) ===== */}
                  <div className="border rounded-lg p-4 space-y-4 bg-card">
                    <h3 className="font-semibold text-sm flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      Arbeitszeit
                    </h3>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label>Beginn</Label>
                        <Input
                          type="time"
                          value={dayStart}
                          onChange={(e) => setDayStart(e.target.value)}
                          required
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Ende</Label>
                        <Input
                          type="time"
                          value={dayEnd}
                          onChange={(e) => setDayEnd(e.target.value)}
                          required
                        />
                      </div>
                    </div>

                    {/* Pausen als Minuten-Rad */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label>Pause Vormittag</Label>
                        <Select value={pauseVormittag} onValueChange={setPauseVormittag}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent className="max-h-60">
                            {pauseOptions(60).map((m) => (
                              <SelectItem key={m} value={m}>{m} Min.</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Pause Mittag</Label>
                        <Select value={pauseMittag} onValueChange={setPauseMittag}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent className="max-h-60">
                            {pauseOptions(90).map((m) => (
                              <SelectItem key={m} value={m}>{m} Min.</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={applyFullDayPreset}
                      className="w-full text-xs"
                    >
                      <Sun className="w-3 h-3 mr-1" />
                      Regelarbeitszeit einfüllen
                    </Button>

                    <div className="bg-muted/50 rounded px-3 py-2 flex items-center justify-between text-sm">
                      <span>Netto-Arbeitszeit</span>
                      <span className="font-bold">{formatMinutesAsHours(netMinutes)} h</span>
                    </div>
                  </div>

                  {/* ===== 2) Projektzeiten (Verteilung) ===== */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-sm flex items-center gap-2">
                        <FolderOpen className="w-4 h-4" />
                        Projektzeiten
                      </h3>
                      {netMinutes > 0 && (
                        <Badge variant={restMinutes === 0 ? "secondary" : "destructive"} className="text-xs">
                          {restMinutes === 0
                            ? "Alles verteilt ✓"
                            : restMinutes > 0
                              ? `Rest: ${formatMinutesAsHours(restMinutes)} h`
                              : `${formatMinutesAsHours(-restMinutes)} h zu viel`}
                        </Badge>
                      )}
                    </div>

                    {allocations.map((alloc, index) => {
                      const allocSubfolders = subfolders.filter(s => s.project_id === alloc.projectId);
                      return (
                        <div
                          key={alloc.id}
                          className="border rounded-lg p-4 space-y-4 bg-card"
                        >
                          <div className="flex items-center justify-between">
                            <h4 className="font-medium text-sm">
                              {allocations.length > 1 ? `Projektzeit ${index + 1}` : "Projektzeit"}
                            </h4>
                            {allocations.length > 1 && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => removeAllocation(alloc.id)}
                                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            )}
                          </div>

                          {/* Location selection */}
                          <div className="space-y-2">
                            <Label>Arbeitsort</Label>
                            <RadioGroup
                              value={alloc.locationType}
                              onValueChange={(value: 'baustelle' | 'werkstatt') => updateAllocation(alloc.id, { locationType: value })}
                              className="grid grid-cols-2 gap-4"
                            >
                              <div>
                                <RadioGroupItem value="baustelle" id={`baustelle-${alloc.id}`} className="peer sr-only" />
                                <Label htmlFor={`baustelle-${alloc.id}`} className="flex h-12 cursor-pointer items-center justify-center rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent peer-data-[state=checked]:border-primary text-sm">
                                  🏗️ Baustelle
                                </Label>
                              </div>
                              <div>
                                <RadioGroupItem value="werkstatt" id={`werkstatt-${alloc.id}`} className="peer sr-only" />
                                <Label htmlFor={`werkstatt-${alloc.id}`} className="flex h-12 cursor-pointer items-center justify-center rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent peer-data-[state=checked]:border-primary text-sm">
                                  🔧 Werkstatt
                                </Label>
                              </div>
                            </RadioGroup>
                          </div>

                          {/* Project selection - für Baustelle UND Werkstatt */}
                          <div className="space-y-2">
                            <Label>Projekt <span className="text-muted-foreground font-normal">(optional)</span></Label>
                            <Select
                              value={alloc.projectId}
                              onValueChange={(value) => {
                                if (value === "new") {
                                  setPendingAllocForNewProject(alloc.id);
                                  setShowNewProjectDialog(true);
                                } else {
                                  updateAllocation(alloc.id, { projectId: value, subfolderId: "" });
                                }
                              }}
                            >
                              <SelectTrigger><SelectValue placeholder="Projekt auswählen" /></SelectTrigger>
                              <SelectContent>
                                {projects.map((p) => (
                                  <SelectItem key={p.id} value={p.id}>{p.name} ({p.plz})</SelectItem>
                                ))}
                                <SelectItem value="new" className="text-primary font-semibold">
                                  <div className="flex items-center gap-2"><Plus className="w-4 h-4" />Neues Projekt erstellen</div>
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          {/* Unterordner - wenn Projekt gewählt */}
                          {alloc.projectId && (
                            <div className="space-y-2">
                              <Label>Unterordner <span className="text-muted-foreground font-normal">(optional)</span></Label>
                              <Select
                                value={alloc.subfolderId}
                                onValueChange={(value) => {
                                  if (value === "new") {
                                    setPendingAllocForNewSubfolder(alloc.id);
                                    setShowNewSubfolderDialog(true);
                                  } else if (value === "none") {
                                    updateAllocation(alloc.id, { subfolderId: "" });
                                  } else {
                                    updateAllocation(alloc.id, { subfolderId: value });
                                  }
                                }}
                              >
                                <SelectTrigger><SelectValue placeholder="z.B. Zuschneiden, Montage..." /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none" className="text-muted-foreground">Kein Unterordner</SelectItem>
                                  {allocSubfolders.map((s) => (
                                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                                  ))}
                                  <SelectItem value="new" className="text-primary font-semibold">
                                    <div className="flex items-center gap-2"><Plus className="w-4 h-4" />Neuer Unterordner</div>
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          )}

                          {/* Activity - optional */}
                          <div className="space-y-2">
                            <Label>Tätigkeit <span className="text-muted-foreground font-normal">(optional)</span></Label>
                            <Input
                              value={alloc.taetigkeit}
                              onChange={(e) => updateAllocation(alloc.id, { taetigkeit: e.target.value })}
                              placeholder="Optional - z.B. Montage, Aufmaß..."
                            />
                          </div>

                          {/* Dauer: Stunden + Viertelstunden-Rad */}
                          <div className="space-y-1.5">
                            <Label>Dauer</Label>
                            <div className="flex items-center gap-2">
                              <Select value={alloc.hours} onValueChange={(v) => updateAllocation(alloc.id, { hours: v })}>
                                <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                                <SelectContent className="max-h-60">
                                  {HOUR_OPTIONS.map((h) => (
                                    <SelectItem key={h} value={h}>{h} Std.</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Select value={alloc.minutes} onValueChange={(v) => updateAllocation(alloc.id, { minutes: v })}>
                                <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {QUARTER_OPTIONS.map((m) => (
                                    <SelectItem key={m} value={m}>{m} Min.</SelectItem>
                                  ))}
                                  {!QUARTER_OPTIONS.includes(alloc.minutes) && (
                                    <SelectItem value={alloc.minutes}>{alloc.minutes} Min.</SelectItem>
                                  )}
                                </SelectContent>
                              </Select>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => applyRestToAllocation(alloc.id)}
                                disabled={restMinutes <= 0}
                                className="whitespace-nowrap text-xs"
                              >
                                Rest übernehmen
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {/* Add another allocation */}
                    <Button
                      type="button"
                      variant="outline"
                      onClick={addAllocation}
                      className="w-full gap-2 border-dashed"
                    >
                      <Plus className="w-4 h-4" />
                      Weitere Projektzeit hinzufügen
                    </Button>
                  </div>

                  {/* Total hours */}
                  <div className="bg-primary/10 border border-primary/30 rounded-lg p-4 flex items-center justify-between">
                    <span className="font-medium">Gesamt zu buchen</span>
                    <span className="text-2xl font-bold">{(totalAllocatedMinutes / 60).toFixed(2)} h</span>
                  </div>

                  <Button type="submit" className="w-full" disabled={saving}>
                    {saving ? "Wird gespeichert..." : "Stunden erfassen"}
                  </Button>
                </>
              )}
            </form>
          </CardContent>
        </Card>

        {/* New Project Dialog */}
        <Dialog open={showNewProjectDialog} onOpenChange={setShowNewProjectDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Neues Projekt erstellen</DialogTitle>
              <DialogDescription>Geben Sie die Details ein.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div><Label>Projektname *</Label><Input value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} /></div>
              <div><Label>PLZ *</Label><Input value={newProjectPlz} onChange={(e) => setNewProjectPlz(e.target.value)} maxLength={5} /></div>
              <div><Label>Adresse</Label><Input value={newProjectAddress} onChange={(e) => setNewProjectAddress(e.target.value)} /></div>
              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowNewProjectDialog(false);
                    setNewProjectName("");
                    setNewProjectPlz("");
                    setNewProjectAddress("");
                    setPendingAllocForNewProject(null);
                  }}
                  disabled={creatingProject}
                >
                  Abbrechen
                </Button>
                <Button onClick={handleCreateNewProject} disabled={creatingProject}>
                  {creatingProject ? 'Wird erstellt...' : 'Erstellen'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* New Subfolder Dialog */}
        <Dialog open={showNewSubfolderDialog} onOpenChange={setShowNewSubfolderDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Neuer Unterordner</DialogTitle>
              <DialogDescription>
                z.B. Zuschneiden, Montage, Oberfläche...
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Name *</Label>
                <Input
                  value={newSubfolderName}
                  onChange={(e) => setNewSubfolderName(e.target.value)}
                  placeholder="z.B. Zuschneiden"
                  autoFocus
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowNewSubfolderDialog(false);
                    setNewSubfolderName("");
                    setPendingAllocForNewSubfolder(null);
                  }}
                  disabled={creatingSubfolder}
                >
                  Abbrechen
                </Button>
                <Button onClick={handleCreateNewSubfolder} disabled={creatingSubfolder}>
                  {creatingSubfolder ? 'Wird erstellt...' : 'Erstellen'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Absence Dialog */}
        <Dialog open={showAbsenceDialog} onOpenChange={setShowAbsenceDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Abwesenheit erfassen</DialogTitle>
              <DialogDescription>Erfassen Sie Urlaub, Krankenstand, ZA, Weiterbildung oder Feiertag</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="absence-date">Datum</Label>
                <Input
                  id="absence-date"
                  type="date"
                  value={absenceData.date}
                  onChange={(e) => setAbsenceData({ ...absenceData, date: e.target.value })}
                />
              </div>

              <div>
                <Label>Art</Label>
                <RadioGroup
                  value={absenceData.type}
                  onValueChange={(value: "urlaub" | "krankenstand" | "weiterbildung" | "feiertag" | "za") => setAbsenceData({ ...absenceData, type: value })}
                  className="grid grid-cols-3 gap-2 mt-2"
                >
                  <div>
                    <RadioGroupItem value="urlaub" id="urlaub" className="peer sr-only" />
                    <Label
                      htmlFor="urlaub"
                      className="flex h-14 cursor-pointer items-center justify-center rounded-md border-2 border-muted bg-popover p-2 hover:bg-accent peer-data-[state=checked]:border-primary text-sm"
                    >
                      🏖️ Urlaub
                    </Label>
                  </div>
                  <div>
                    <RadioGroupItem value="krankenstand" id="krankenstand" className="peer sr-only" />
                    <Label
                      htmlFor="krankenstand"
                      className="flex h-14 cursor-pointer items-center justify-center rounded-md border-2 border-muted bg-popover p-2 hover:bg-accent peer-data-[state=checked]:border-primary text-sm"
                    >
                      🏥 Kranken.
                    </Label>
                  </div>
                  <div>
                    <RadioGroupItem value="za" id="za" className="peer sr-only" />
                    <Label
                      htmlFor="za"
                      className="flex h-14 cursor-pointer items-center justify-center rounded-md border-2 border-muted bg-popover p-2 hover:bg-accent peer-data-[state=checked]:border-primary text-sm"
                    >
                      ⏰ ZA
                    </Label>
                  </div>
                  <div>
                    <RadioGroupItem value="weiterbildung" id="weiterbildung" className="peer sr-only" />
                    <Label
                      htmlFor="weiterbildung"
                      className="flex h-14 cursor-pointer items-center justify-center rounded-md border-2 border-muted bg-popover p-2 hover:bg-accent peer-data-[state=checked]:border-primary text-sm"
                    >
                      📚 Weiterbild.
                    </Label>
                  </div>
                  <div>
                    <RadioGroupItem value="feiertag" id="feiertag" className="peer sr-only" />
                    <Label
                      htmlFor="feiertag"
                      className="flex h-14 cursor-pointer items-center justify-center rounded-md border-2 border-muted bg-popover p-2 hover:bg-accent peer-data-[state=checked]:border-primary text-sm"
                    >
                      🎉 Feiertag
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              {/* Ganzer Tag toggle */}
              <div className="flex items-center justify-between">
                <Label htmlFor="full-day-toggle">Ganzer Tag</Label>
                <Switch
                  id="full-day-toggle"
                  checked={absenceData.isFullDay}
                  onCheckedChange={(checked) => {
                    const dateObj = new Date(absenceData.date);
                    const defaults = getDefaultWorkTimes(dateObj, employeeWochenstunden);
                    setAbsenceData({
                      ...absenceData,
                      isFullDay: checked,
                      absenceStartTime: defaults?.startTime || "06:30",
                      absenceEndTime: defaults?.endTime || "15:30",
                      absencePauseMinutes: String(defaults?.pauseMinutes ?? 60),
                    });
                  }}
                />
              </div>

              {absenceData.isFullDay ? (
                /* Full day: show calculated hours with optional override */
                <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Berechnete Stunden für diesen Tag:</span>
                    <Badge variant="secondary" className="text-lg font-bold px-3 py-1">
                      {absenceData.customHours || getNormalWorkingHours(new Date(absenceData.date), employeeWochenstunden)} h
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {(() => {
                      const absenceDateObj = new Date(absenceData.date);
                      const hours = getNormalWorkingHours(absenceDateObj, employeeWochenstunden);
                      if (hours === 0) return "Kein Arbeitstag: 0 Stunden";
                      return `Arbeitstag: ${hours} Stunden`;
                    })()}
                  </div>
                  <div className="pt-2 border-t">
                    <Label className="text-sm">Stunden anpassen (optional)</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <Input
                        type="number"
                        step="0.5"
                        min="0"
                        max="24"
                        placeholder={String(getNormalWorkingHours(new Date(absenceData.date), employeeWochenstunden))}
                        value={absenceData.customHours}
                        onChange={(e) => setAbsenceData({ ...absenceData, customHours: e.target.value })}
                        className="w-24 text-center"
                      />
                      <span className="text-sm text-muted-foreground">Stunden</span>
                      {absenceData.customHours && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setAbsenceData({ ...absenceData, customHours: "" })}
                        >
                          Zurücksetzen
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                /* Partial day: Von/Bis time inputs */
                <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Von</Label>
                      <Input
                        type="time"
                        value={absenceData.absenceStartTime}
                        onChange={(e) => setAbsenceData({ ...absenceData, absenceStartTime: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Bis</Label>
                      <Input
                        type="time"
                        value={absenceData.absenceEndTime}
                        onChange={(e) => setAbsenceData({ ...absenceData, absenceEndTime: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Pause (Minuten)</Label>
                    <Input
                      type="number"
                      min="0"
                      max="120"
                      value={absenceData.absencePauseMinutes}
                      onChange={(e) => setAbsenceData({ ...absenceData, absencePauseMinutes: e.target.value })}
                      className="w-24"
                    />
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t">
                    <span className="text-sm text-muted-foreground">Berechnete Stunden:</span>
                    <Badge variant="secondary" className="text-lg font-bold px-3 py-1">
                      {(() => {
                        const [sH, sM] = absenceData.absenceStartTime.split(':').map(Number);
                        const [eH, eM] = absenceData.absenceEndTime.split(':').map(Number);
                        const pause = parseInt(absenceData.absencePauseMinutes) || 0;
                        const total = Math.max(0, ((eH * 60 + eM) - (sH * 60 + sM) - pause) / 60);
                        return total.toFixed(2);
                      })()} h
                    </Badge>
                  </div>
                </div>
              )}

              {absenceData.type === "krankenstand" && (
                <div>
                  <Label htmlFor="document">Krankmeldung (optional)</Label>
                  <Input
                    id="document"
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={(e) => setAbsenceData({ ...absenceData, document: e.target.files?.[0] || null })}
                    className="mt-2"
                  />
                </div>
              )}

              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowAbsenceDialog(false);
                    setAbsenceData({ date: new Date().toISOString().split('T')[0], type: "urlaub", document: null, customHours: "", isFullDay: true, absenceStartTime: "06:30", absenceEndTime: "15:30", absencePauseMinutes: "60" });
                  }}
                  disabled={submittingAbsence}
                >
                  Abbrechen
                </Button>
                <Button onClick={handleAbsenceSubmit} disabled={submittingAbsence}>
                  {submittingAbsence ? "Wird gespeichert..." : "Erfassen"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Fill Remaining Hours Dialog */}
        {(() => {
          const bookedTotal = existingDayEntries.reduce((sum, e) => sum + Number(e.stunden), 0);
          const targetHours = getNormalWorkingHours(new Date(selectedDate + "T00:00:00"), employeeWochenstunden);
          const remaining = targetHours - bookedTotal;
          const lastEndTime = existingDayEntries.reduce<string | null>((latest, e) => {
            if (!e.end_time) return latest;
            return (!latest || e.end_time > latest) ? e.end_time : latest;
          }, null);
          return (
            <FillRemainingHoursDialog
              open={showFillDialog}
              onOpenChange={setShowFillDialog}
              remainingHours={remaining}
              bookedHours={bookedTotal}
              targetHours={targetHours}
              projects={projects}
              subfolders={subfolders}
              lastEndTime={lastEndTime}
              onSubmit={handleFillHoursSubmit}
            />
          );
        })()}

      </div>
    </div>
  );
};

export default TimeTracking;
