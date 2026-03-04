import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/hooks/use-toast";
import { ArrowLeft, Download, FileSpreadsheet, Building2, Hammer, ChevronDown } from "lucide-react";
import { format, isSameDay, parseISO } from "date-fns";
import { de } from "date-fns/locale";
import * as XLSX from "xlsx-js-style";
import { cn } from "@/lib/utils";
import ProjectHoursReport from "@/components/ProjectHoursReport";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getNormalWorkingHours, getWorkModelLabel } from "@/lib/workingHours";

interface TimeEntry {
  id: string;
  datum: string;
  start_time: string;
  end_time: string;
  pause_minutes: number;
  pause_start?: string;
  pause_end?: string;
  stunden: number;
  location_type: string;
  project_id: string | null;
  user_id: string;
  taetigkeit: string;
  week_type?: string | null;
  disturbance_id?: string | null;
}

interface Profile {
  vorname: string;
  nachname: string;
}

interface Project {
  id: string;
  name: string;
  adresse?: string;
  plz?: string;
}

const monthNames = [
  "Jänner", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember"
];

export default function HoursReport() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [projects, setProjects] = useState<Record<string, Project>>({});
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [companySettings, setCompanySettings] = useState({ name: "", address: "", email: "" });
  const [employeeWochenstunden, setEmployeeWochenstunden] = useState<number>(40);

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i);

  useEffect(() => {
    checkAdminStatus();
    fetchProfiles();
    fetchProjects();
    fetchCompanySettings();
  }, []);

  const fetchCompanySettings = async () => {
    const { data } = await supabase.from("app_settings").select("key, value").in("key", ["company_name", "company_address", "company_email"]);
    if (data) {
      const settings = Object.fromEntries(data.map(({ key, value }) => [key, value]));
      setCompanySettings({ name: settings.company_name || "", address: settings.company_address || "", email: settings.company_email || "" });
    }
  };

  useEffect(() => {
    if (selectedUserId) {
      fetchTimeEntries();
      fetchEmployeeWochenstunden();
    }
  }, [month, year, selectedUserId]);

  const fetchEmployeeWochenstunden = async () => {
    const { data } = await supabase
      .from("employees")
      .select("wochenstunden")
      .eq("user_id", selectedUserId)
      .maybeSingle();
    if (data?.wochenstunden) {
      setEmployeeWochenstunden(data.wochenstunden);
    } else {
      setEmployeeWochenstunden(40);
    }
  };

  const checkAdminStatus = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from("user_roles").select("role").eq("user_id", user.id).single();
    const admin = data?.role === "administrator";
    setIsAdmin(admin);
    if (!admin) {
      setSelectedUserId(user.id);
    } else {
      const employeeParam = searchParams.get("employee");
      if (employeeParam) setSelectedUserId(employeeParam);
    }
  };

  const fetchProfiles = async () => {
    const { data } = await supabase.from("profiles").select("id, vorname, nachname");
    if (data) {
      const profileMap: Record<string, Profile> = {};
      data.forEach((p) => { profileMap[p.id] = { vorname: p.vorname, nachname: p.nachname }; });
      setProfiles(profileMap);
    }
  };

  const fetchProjects = async () => {
    const { data } = await supabase.from("projects").select("id, name, adresse, plz");
    if (data) {
      const projectMap: Record<string, Project> = {};
      data.forEach((p) => { projectMap[p.id] = p; });
      setProjects(projectMap);
    }
  };

  const fetchTimeEntries = async () => {
    setLoading(true);
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);
    const { data, error } = await supabase
      .from("time_entries").select("*").eq("user_id", selectedUserId)
      .gte("datum", format(startDate, "yyyy-MM-dd")).lte("datum", format(endDate, "yyyy-MM-dd")).order("datum");
    if (error) {
      toast({ title: "Fehler beim Laden", description: error.message, variant: "destructive" });
    } else {
      setTimeEntries(data || []);
    }
    setLoading(false);
  };

  const generateMonthDays = () => {
    const daysInMonth = new Date(year, month, 0).getDate();
    const days = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month - 1, day);
      const dayOfWeek = date.getDay();
      days.push({ date, dayNumber: day, dayOfWeek, isWeekend: dayOfWeek === 0 || dayOfWeek === 6, isFriday: dayOfWeek === 5 });
    }
    return days;
  };

  const calculateDifference = (date: Date, totalHours: number): number => {
    const normalHours = getNormalWorkingHours(date, employeeWochenstunden);
    return totalHours - normalHours;
  };

  const calculateLunchBreak = (entry: TimeEntry) => {
    if (entry.pause_start && entry.pause_end) {
      return { start: entry.pause_start.substring(0, 5), end: entry.pause_end.substring(0, 5) };
    }
    if (!entry.pause_minutes || entry.pause_minutes === 0) return null;
    const pauseStart = new Date("2000-01-01T12:00:00");
    const pauseEnd = new Date(pauseStart);
    pauseEnd.setMinutes(pauseEnd.getMinutes() + entry.pause_minutes);
    return { start: format(pauseStart, "HH:mm"), end: format(pauseEnd, "HH:mm") };
  };

  const monthDays = generateMonthDays();
  const totalHours = timeEntries.reduce((sum, entry) => sum + entry.stunden, 0);
  const totalDifference = timeEntries.reduce((sum, entry) => {
    const entryDate = parseISO(entry.datum);
    return sum + calculateDifference(entryDate, entry.stunden);
  }, 0);

  const addBordersToCell = (cell: any, thick: boolean = false, centered: boolean = false) => {
    const borderStyle = thick ? "medium" : "thin";
    cell.s = {
      border: {
        top: { style: borderStyle, color: { rgb: "000000" } },
        bottom: { style: borderStyle, color: { rgb: "000000" } },
        left: { style: borderStyle, color: { rgb: "000000" } },
        right: { style: borderStyle, color: { rgb: "000000" } },
      },
      alignment: { vertical: "center", horizontal: centered ? "center" : "left" },
    };
  };

  const exportToExcel = (includeZDA: boolean = true) => {
    if (!selectedUserId) { toast({ title: "Kein Mitarbeiter ausgewählt", variant: "destructive" }); return; }
    const employeeName = profiles[selectedUserId] ? `${profiles[selectedUserId].vorname} ${profiles[selectedUserId].nachname}` : "Mitarbeiter";
    const monthNamesShort = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

    const worksheetData: any[][] = [
      [companySettings.name, "", "", "", "", "", "", "", "", "", "", ""],
      [companySettings.address, "", "", "", "", "", "", "", "", "", "", ""],
      [`E-Mail: ${companySettings.email}`, "", "", "", "", "", "", "", "", "", "", ""],
      ["", "", "", "", "", "", "", "", "", "", "", ""],
      ["Dienstnehmer:", "", employeeName, "", "", "", "", "", "Monat:", `${monthNamesShort[month - 1]}-${year.toString().slice(-2)}`, "", ""],
      ["Arbeitszeitmodell:", "", getWorkModelLabel(employeeWochenstunden), "", "", "", "", "", "", "", "", ""],
      ["", "", "", "", "", "", "", "", "", "", "", ""],
    ];

    if (includeZDA) {
      worksheetData.push(
        ["Datum", "V o r m i t t a g", "", "Unterbrechung", "N a c h m i t t a g", "", "Stunden", "ZDA", "Ort", "Projekt", "Tätigkeit", "PLZ"],
        ["", "Beginn", "Ende", "von - bis", "Beginn", "Ende", "Gesamt", "", "", "", "", ""]
      );
    } else {
      worksheetData.push(
        ["Datum", "V o r m i t t a g", "", "Unterbrechung", "N a c h m i t t a g", "", "Stunden", "Ort", "Projekt", "Tätigkeit", "PLZ", ""],
        ["", "Beginn", "Ende", "von - bis", "Beginn", "Ende", "Gesamt", "", "", "", "", ""]
      );
    }
    worksheetData.push(["", "", "", "", "", "", "", "", "", "", "", ""]);
    const prevMonthLastDay = new Date(year, month - 1, 0).getDate();
    worksheetData.push([prevMonthLastDay, "", "", "", "", "", "", "", "", "", "", ""]);

    const daysInMonth = new Date(year, month, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const dayDate = new Date(year, month - 1, day);
      const dayEntries = timeEntries.filter((e) => isSameDay(parseISO(e.datum), dayDate));

      if (dayEntries.length === 0) {
        worksheetData.push([day, "", "", "", "", "", "", "", "", "", "", ""]);
      } else {
        dayEntries.forEach((entry, entryIndex) => {
          const lunchBreak = calculateLunchBreak(entry);
          const project = projects[entry.project_id];
          const ortText = entry.location_type === "baustelle" ? "Baustelle" : "Werkstatt";
          const isAbsence = ["Urlaub", "Krankenstand", "Weiterbildung", "Feiertag"].includes(entry.taetigkeit);
          const isDisturbance = entry.disturbance_id != null || entry.taetigkeit?.startsWith("Störungseinsatz");
          let projektName = "";
          if (isAbsence) { projektName = entry.taetigkeit; }
          else if (isDisturbance) { projektName = "Störung"; }
          else { projektName = project?.name || ""; }
          const plz = (isAbsence || isDisturbance) ? "" : entry.location_type === "baustelle" ? (project?.plz || "") : "";
          const displayDay = entryIndex === 0 ? day : "";

          if (includeZDA) {
            const actualMorningEnd = lunchBreak?.start || "";
            const actualAfternoonStart = lunchBreak?.end || "";
            const actualPauseText = entry.pause_minutes && entry.pause_minutes > 0 && lunchBreak ? `${lunchBreak.start} - ${lunchBreak.end}` : "";
            const diff = calculateDifference(dayDate, entry.stunden);
            const diffText = diff !== 0 ? diff.toFixed(2) : "";
            worksheetData.push([displayDay, entry.start_time?.substring(0, 5) || "", actualMorningEnd, actualPauseText, actualAfternoonStart, entry.end_time?.substring(0, 5) || "", entry.stunden.toFixed(2), diffText, ortText, projektName, entry.taetigkeit, plz]);
          } else {
            const isWorkday = getNormalWorkingHours(dayDate, employeeWochenstunden) > 0;
            const regelarbeitszeit = getNormalWorkingHours(dayDate, employeeWochenstunden);
            const regelStart = isWorkday ? "06:30" : "";
            const regelMorningEnd = isWorkday ? "12:00" : "";
            const regelPause = isWorkday ? "12:00 - 13:00" : "";
            const regelAfternoonStart = isWorkday ? "13:00" : "";
            const regelEnd = isWorkday ? "15:30" : "";
            worksheetData.push([displayDay, regelStart, regelMorningEnd, regelPause, regelAfternoonStart, regelEnd, regelarbeitszeit.toFixed(2), ortText, projektName, entry.taetigkeit, plz, ""]);
          }
        });
        if (dayEntries.length > 1) {
          const dayTotalHours = dayEntries.reduce((sum, e) => sum + e.stunden, 0);
          const dayTotalDiff = dayEntries.reduce((sum, e) => sum + calculateDifference(dayDate, e.stunden), 0);
          if (includeZDA) {
            worksheetData.push(["", "", "", "", "", "Tagessumme:", dayTotalHours.toFixed(2), dayTotalDiff !== 0 ? dayTotalDiff.toFixed(2) : "", "", "", "", ""]);
          } else {
            const regelarbeitszeitTag = getNormalWorkingHours(dayDate, employeeWochenstunden);
            worksheetData.push(["", "", "", "", "", "Tagessumme:", regelarbeitszeitTag.toFixed(2), "", "", "", "", ""]);
          }
        }
      }
    }

    const calculateRegelarbeitszeitSumme = () => {
      let summe = 0;
      for (let day = 1; day <= daysInMonth; day++) {
        const dayDate = new Date(year, month - 1, day);
        const dayEntries = timeEntries.filter((e) => isSameDay(parseISO(e.datum), dayDate));
        if (dayEntries.length > 0) { summe += getNormalWorkingHours(dayDate, employeeWochenstunden); }
      }
      return summe;
    };

    if (includeZDA) {
      worksheetData.push(["", "", "", "", "", "SUMME", totalHours.toFixed(2), totalDifference.toFixed(2), "", "", "", ""]);
    } else {
      const regelarbeitszeitSumme = calculateRegelarbeitszeitSumme();
      worksheetData.push(["", "", "", "", "", "SUMME", regelarbeitszeitSumme.toFixed(2), "", "", "", "", ""]);
    }

    worksheetData.push(["", "", "", "", "", "", "", "", "", "", "", ""]);
    worksheetData.push(["", "", "", "", "", "", "", "", "", "", "", ""]);
    worksheetData.push(["", "", "", "", "", "", "", "", "", "", "", ""]);
    if (includeZDA) {
      worksheetData.push(["", "Hiermit bestätige ich die Richtigkeit der von mir angegebenen ZDA-Stunden.", "", "", "", "", "", "", "", "", "", ""]);
      worksheetData.push(["", "", "", "", "", "", "", "", "", "", "", ""]);
      worksheetData.push(["", `Derzeitiger offener ZDA-Stand: ${totalDifference.toFixed(2)}`, "", "", "", "", "", "", "", "", "", ""]);
      worksheetData.push(["", "Restliche ZDA-Stunden wurden zur Gänze abgegolten.", "", "", "", "", "", "", "", "", "", ""]);
    } else {
      worksheetData.push(["", "", "", "", "", "", "", "", "", "", "", ""]);
      worksheetData.push(["", "", "", "", "", "", "", "", "", "", "", ""]);
      worksheetData.push(["", "", "", "", "", "", "", "", "", "", "", ""]);
      worksheetData.push(["", "", "", "", "", "", "", "", "", "", "", ""]);
    }
    worksheetData.push(["", "", "", "", "", "", "", "", "", "", "", ""]);
    worksheetData.push(["", "Datum:", "", "", "", "Unterschrift:", "", "", "", "", "", ""]);

    const ws = XLSX.utils.aoa_to_sheet(worksheetData);
    ws["!cols"] = [{ wch: 12 }, { wch: 24 }, { wch: 24 }, { wch: 26 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 22 }, { wch: 20 }, { wch: 6 }];

    const sumRowIndex = worksheetData.length - 9;
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 5 } }, { s: { r: 3, c: 0 }, e: { r: 3, c: 5 } },
      { s: { r: 5, c: 0 }, e: { r: 5, c: 1 } }, { s: { r: 5, c: 2 }, e: { r: 5, c: 7 } },
      { s: { r: 5, c: 9 }, e: { r: 5, c: 11 } },
      { s: { r: 7, c: 1 }, e: { r: 7, c: 2 } }, { s: { r: 7, c: 4 }, e: { r: 7, c: 5 } },
      { s: { r: sumRowIndex + 4, c: 1 }, e: { r: sumRowIndex + 4, c: 10 } },
      { s: { r: sumRowIndex + 6, c: 1 }, e: { r: sumRowIndex + 6, c: 10 } },
      { s: { r: sumRowIndex + 7, c: 1 }, e: { r: sumRowIndex + 7, c: 10 } }
    ];

    ws["!rows"] = ws["!rows"] || [];
    [0, 1, 2, 3].forEach((r) => { ws["!rows"][r] = { hpt: 18 }; });
    ws["!rows"][sumRowIndex + 4] = { hpt: 30 };
    ws["!rows"][sumRowIndex + 6] = { hpt: 25 };

    const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
    for (let R = range.s.r; R <= range.e.r; ++R) {
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
        if (!ws[cellAddress]) { ws[cellAddress] = { t: "s", v: "" }; }
        const isFirmenHeader = R >= 0 && R <= 3;
        const isHeaderRow = R === 7 || R === 8;
        const footerBaseRow = worksheetData.length - 9;
        const isSumRow = R === footerBaseRow;
        const isFooterRow = R >= footerBaseRow + 1;
        const borderStyle = isHeaderRow ? "medium" : "thin";
        if (isFirmenHeader || isFooterRow) {
          ws[cellAddress].s = { alignment: { vertical: "center", horizontal: "left", wrapText: true }, font: { bold: R === 0, size: R === 0 ? 14 : 11 } };
        } else {
          ws[cellAddress].s = {
            border: { top: { style: borderStyle, color: { rgb: "000000" } }, bottom: { style: borderStyle, color: { rgb: "000000" } }, left: { style: borderStyle, color: { rgb: "000000" } }, right: { style: borderStyle, color: { rgb: "000000" } } },
            alignment: { vertical: "center", horizontal: isHeaderRow ? "center" : "left", wrapText: false },
          };
          if (isHeaderRow || isSumRow) { ws[cellAddress].s = { ...ws[cellAddress].s, font: { bold: true } }; }
        }
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Arbeitszeit");
    const suffix = includeZDA ? "_mit_ZDA" : "_ohne_ZDA";
    XLSX.writeFile(wb, `Arbeitszeiterfassung_${employeeName}_${monthNamesShort[month - 1]}_${year}${suffix}.xlsx`);
    toast({ title: "Excel exportiert", description: "Datei wurde heruntergeladen" });
  };

  return (
    <div className="container mx-auto p-4 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <h1 className="text-3xl font-bold">Stundenauswertung</h1>
      </div>

      <Tabs defaultValue="mitarbeiter" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="mitarbeiter">
            <FileSpreadsheet className="w-4 h-4 mr-2" />
            Arbeitszeiterfassung
          </TabsTrigger>
          <TabsTrigger value="projekte">
            <Building2 className="w-4 h-4 mr-2" />
            Projektzeiterfassung
          </TabsTrigger>
        </TabsList>

        <TabsContent value="mitarbeiter" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
                    <FileSpreadsheet className="w-5 h-5 sm:w-6 sm:h-6" />
                    Arbeitszeiterfassung nach Mitarbeitern
                  </CardTitle>
                  <CardDescription className="text-xs sm:text-sm">Monatsberichte mit ZDA exportieren</CardDescription>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button disabled={!selectedUserId} className="h-11">
                      <Download className="mr-2 h-4 w-4" />
                      <span className="hidden sm:inline">Excel exportieren</span>
                      <span className="sm:hidden">Export</span>
                      <ChevronDown className="ml-2 h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => exportToExcel(true)}>Mit ZDA</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => exportToExcel(false)}>Ohne ZDA</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-3">
                {isAdmin && (
                  <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                    <SelectTrigger className="h-11"><SelectValue placeholder="Mitarbeiter auswählen" /></SelectTrigger>
                    <SelectContent position="popper">
                      {Object.entries(profiles).map(([id, profile]) => (
                        <SelectItem key={id} value={id}>{profile.vorname} {profile.nachname}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Select value={month.toString()} onValueChange={(v) => setMonth(parseInt(v))}>
                  <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent position="popper">
                    {monthNames.map((name, i) => (<SelectItem key={i} value={(i + 1).toString()}>{name}</SelectItem>))}
                  </SelectContent>
                </Select>
                <Select value={year.toString()} onValueChange={(v) => setYear(parseInt(v))}>
                  <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent position="popper">
                    {years.map((y) => (<SelectItem key={y} value={y.toString()}>{y}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>

              {selectedUserId && (
                <>
                  <div className="bg-muted/50 p-4 rounded-lg">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm text-muted-foreground">Gesamtstunden</p>
                        <p className="text-2xl font-bold">{totalHours.toFixed(2)} h</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">ZDA</p>
                        <p className={cn("text-2xl font-bold", totalDifference > 0 && "text-green-600", totalDifference < 0 && "text-destructive")}>
                          {totalDifference > 0 ? "+" : ""}{totalDifference.toFixed(2)} h
                        </p>
                      </div>
                    </div>
                  </div>

                  <ScrollArea className="h-[500px] rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[100px]">Datum</TableHead>
                          <TableHead>Vormittag</TableHead>
                          <TableHead>Pause</TableHead>
                          <TableHead>Nachmittag</TableHead>
                          <TableHead className="text-right">Stunden</TableHead>
                          <TableHead className="text-right">ZDA</TableHead>
                          <TableHead>Ort</TableHead>
                          <TableHead>Projekt</TableHead>
                          <TableHead>Tätigkeit</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {loading ? (
                          <TableRow><TableCell colSpan={9} className="text-center">Lade...</TableCell></TableRow>
                        ) : monthDays.length === 0 ? (
                          <TableRow><TableCell colSpan={9} className="text-center">Keine Daten verfügbar</TableCell></TableRow>
                        ) : (
                          monthDays.map((day) => {
                            const dayEntries = timeEntries.filter((e) => isSameDay(parseISO(e.datum), day.date));
                            const dayTotalHours = dayEntries.reduce((sum, e) => sum + e.stunden, 0);
                            const hasMultipleEntries = dayEntries.length > 1;

                            if (dayEntries.length === 0) {
                              return (
                                <TableRow key={day.dayNumber} className={cn(day.isWeekend && "bg-muted/30", "text-muted-foreground")}>
                                  <TableCell className="font-medium">
                                    <div className="flex flex-col">
                                      <span>{day.dayNumber}</span>
                                      <span className="text-xs text-muted-foreground">{format(day.date, "EEE", { locale: de })}</span>
                                    </div>
                                  </TableCell>
                                  <TableCell colSpan={8}></TableCell>
                                </TableRow>
                              );
                            }

                            return dayEntries.map((entry, entryIndex) => {
                              const lunchBreak = calculateLunchBreak(entry);
                              const diff = calculateDifference(day.date, entry.stunden);
                              const project = projects[entry.project_id];
                              const ortIcon = entry.location_type === "baustelle" ? "🏗️" : entry.location_type === "werkstatt" ? "🔧" : "";
                              const ortText = entry.location_type === "baustelle" ? "Baustelle" : entry.location_type === "werkstatt" ? "Werkstatt" : "";
                              const projektName = entry.taetigkeit === "Urlaub" || entry.taetigkeit === "Krankenstand" ? entry.taetigkeit : (project?.name || "");
                              const isFirstEntry = entryIndex === 0;
                              const isLastEntry = entryIndex === dayEntries.length - 1;

                              return (
                                <TableRow key={entry.id} className={cn(day.isWeekend && "bg-muted/30", hasMultipleEntries && !isLastEntry && "border-b-0")}>
                                  <TableCell className="font-medium">
                                    {isFirstEntry && (
                                      <div className="flex flex-col">
                                        <span>{day.dayNumber}</span>
                                        <span className="text-xs text-muted-foreground">{format(day.date, "EEE", { locale: de })}</span>
                                      </div>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex items-center gap-1">
                                      <span>{entry.start_time?.substring(0, 5)}</span><span>-</span><span>{"12:00"}</span>
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    {lunchBreak && entry.pause_minutes > 0 && (<span className="text-sm">{lunchBreak.start} - {lunchBreak.end}</span>)}
                                  </TableCell>
                                  <TableCell>
                                    {lunchBreak && (
                                      <div className="flex items-center gap-1">
                                        <span>{lunchBreak.end}</span><span>-</span><span>{entry.end_time?.substring(0, 5)}</span>
                                      </div>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-right font-medium">
                                    {entry.stunden.toFixed(2)} h
                                    {hasMultipleEntries && isLastEntry && (
                                      <div className="text-xs text-primary font-bold mt-1">Σ {dayTotalHours.toFixed(2)} h</div>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {diff !== 0 && (
                                      <span className={cn("font-medium", diff > 0 && "text-green-600", diff < 0 && "text-destructive")}>
                                        {diff > 0 ? "+" : ""}{diff.toFixed(2)} h
                                      </span>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    <span className="flex items-center gap-1"><span>{ortIcon}</span><span className="text-xs">{ortText}</span></span>
                                  </TableCell>
                                  <TableCell className="max-w-[150px] truncate">{projektName}</TableCell>
                                  <TableCell className="max-w-[150px] truncate">{entry.taetigkeit}</TableCell>
                                </TableRow>
                              );
                            });
                          })
                        )}
                      </TableBody>
                      <TableFooter>
                        <TableRow>
                          <TableCell colSpan={4} className="text-right font-bold">Gesamt:</TableCell>
                          <TableCell className="text-right font-bold">{totalHours.toFixed(2)} h</TableCell>
                          <TableCell className={cn("text-right font-bold", totalDifference > 0 && "text-green-600", totalDifference < 0 && "text-destructive")}>
                            {totalDifference > 0 ? "+" : ""}{totalDifference.toFixed(2)} h
                          </TableCell>
                          <TableCell colSpan={3}></TableCell>
                        </TableRow>
                      </TableFooter>
                    </Table>
                  </ScrollArea>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="projekte">
          <ProjectHoursReport />
        </TabsContent>
      </Tabs>
    </div>
  );
}
