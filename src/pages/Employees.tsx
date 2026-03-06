import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { toast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { ArrowLeft, Plus, User, FileText, Clock, Mail, Phone, MapPin, FileSpreadsheet, Shirt, Trash2, Loader2, Download } from "lucide-react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import * as XLSX from "xlsx-js-style";
import EmployeeDocumentsManager from "@/components/EmployeeDocumentsManager";
import { getNormalWorkingHours } from "@/lib/workingHours";

interface Employee {
  id: string;
  user_id: string | null;
  vorname: string;
  nachname: string;
  geburtsdatum: string | null;
  adresse: string | null;
  plz: string | null;
  ort: string | null;
  telefon: string | null;
  email: string | null;
  sv_nummer: string | null;
  eintritt_datum: string | null;
  austritt_datum: string | null;
  position: string | null;
  beschaeftigung_art: string | null;
  wochenstunden: number | null;
  stundenlohn: number | null;
  iban: string | null;
  bic: string | null;
  bank_name: string | null;
  kleidungsgroesse: string | null;
  schuhgroesse: string | null;
  notizen: string | null;
}

export default function Employees() {
  const navigate = useNavigate();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [loading, setLoading] = useState(true);
  const [formData, setFormData] = useState<Partial<Employee>>({});
  const [newEmployee, setNewEmployee] = useState({ vorname: "", nachname: "", email: "", wochenstunden: 40 });
  const [showSizesDialog, setShowSizesDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    checkAdminAccess();
    fetchEmployees();
  }, []);

  const checkAdminAccess = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      navigate("/auth");
      return;
    }

    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .single();

    if (data?.role !== "administrator") {
      toast({ title: "Keine Berechtigung", description: "Nur Administratoren können auf diese Seite zugreifen", variant: "destructive" });
      navigate("/");
    }
  };

  const fetchEmployees = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("employees")
      .select("*")
      .order("nachname");

    if (error) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
    } else {
      setEmployees(data || []);
    }
    setLoading(false);
  };

  const handleCreateEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const { data, error } = await supabase
        .from("employees")
        .insert({
          vorname: newEmployee.vorname,
          nachname: newEmployee.nachname,
          email: newEmployee.email || null,
          wochenstunden: newEmployee.wochenstunden,
        })
        .select()
        .single();

      if (error) throw error;

      toast({ title: "Erfolg", description: "Mitarbeiter wurde angelegt" });
      setShowCreateDialog(false);
      setNewEmployee({ vorname: "", nachname: "", email: "", wochenstunden: 40 });
      fetchEmployees();
    } catch (error: any) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
    }
  };

  const handleSaveEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmployee) return;

    try {
      const { error } = await supabase
        .from("employees")
        .update(formData)
        .eq("id", selectedEmployee.id);

      if (error) throw error;

      toast({ title: "Erfolg", description: "Änderungen gespeichert" });
      fetchEmployees();
      setSelectedEmployee(null);
    } catch (error: any) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
    }
  };

  const generateExcelBackup = async (employee: Employee): Promise<Uint8Array | null> => {
    if (!employee.user_id) return null;

    const { data: entries } = await supabase
      .from("time_entries")
      .select("*")
      .eq("user_id", employee.user_id)
      .order("datum", { ascending: true });

    if (!entries || entries.length === 0) return null;

    const wb = XLSX.utils.book_new();

    // Group entries by month
    const grouped: Record<string, typeof entries> = {};
    entries.forEach((e) => {
      const key = e.datum.substring(0, 7); // "YYYY-MM"
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(e);
    });

    const monthNames = ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

    Object.keys(grouped).sort().forEach((monthKey) => {
      const monthEntries = grouped[monthKey];
      const [y, m] = monthKey.split("-").map(Number);
      const sheetName = `${monthNames[m - 1]} ${y}`;

      const header = ["Datum", "Tag", "Start", "Ende", "Pause", "Stunden", "Tätigkeit", "Ort", "Notizen"];
      const rows = monthEntries.map((e) => {
        const date = new Date(e.datum);
        const dayName = format(date, "EEEE", { locale: de });
        return [
          format(date, "dd.MM.yyyy"),
          dayName,
          e.start_time?.slice(0, 5) || "",
          e.end_time?.slice(0, 5) || "",
          e.pause_minutes || 0,
          e.stunden,
          e.taetigkeit || "",
          e.location_type || "",
          e.notizen || "",
        ];
      });

      const totalHours = monthEntries.reduce((sum, e) => sum + (e.stunden || 0), 0);
      rows.push(["", "", "", "", "Summe:", totalHours, "", "", ""]);

      const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
      ws["!cols"] = [{ wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 15 }, { wch: 12 }, { wch: 25 }];

      // Bold header
      for (let c = 0; c < header.length; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
        if (cell) cell.s = { font: { bold: true } };
      }

      XLSX.utils.book_append_sheet(wb, ws, sheetName.substring(0, 31));
    });

    return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;
  };

  const handleDeleteEmployee = async () => {
    if (!selectedEmployee) return;
    setDeleting(true);

    try {
      const fullName = `${selectedEmployee.vorname} ${selectedEmployee.nachname}`;

      // 1. Generate Excel backup
      const excelData = await generateExcelBackup(selectedEmployee);

      if (excelData) {
        // Download locally
        const blob = new Blob([excelData], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `Stundenbackup_${selectedEmployee.nachname}_${selectedEmployee.vorname}_${format(new Date(), "yyyy-MM-dd")}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);

        // Upload to Supabase storage
        const fileName = `${selectedEmployee.id}_${selectedEmployee.nachname}_${selectedEmployee.vorname}_${format(new Date(), "yyyy-MM-dd")}.xlsx`;
        await supabase.storage
          .from("deleted-users")
          .upload(fileName, excelData, {
            contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            upsert: true,
          });
      }

      // 2. Update time_entries: set user_id to NULL, add name to notizen
      if (selectedEmployee.user_id) {
        const { data: timeEntries } = await supabase
          .from("time_entries")
          .select("id, notizen")
          .eq("user_id", selectedEmployee.user_id);

        if (timeEntries && timeEntries.length > 0) {
          // Update in batches
          for (const entry of timeEntries) {
            const newNotizen = entry.notizen
              ? `[${fullName}] ${entry.notizen}`
              : `[${fullName}]`;
            await supabase
              .from("time_entries")
              .update({ user_id: null, notizen: newNotizen })
              .eq("id", entry.id);
          }
        }

        // 3. Delete disturbance reports
        await supabase
          .from("disturbances")
          .delete()
          .eq("user_id", selectedEmployee.user_id);

        // 4. Deactivate profile
        await supabase
          .from("profiles")
          .update({ is_active: false })
          .eq("id", selectedEmployee.user_id);
      }

      // 5. Delete employee record
      await supabase
        .from("employees")
        .delete()
        .eq("id", selectedEmployee.id);

      toast({
        title: "Mitarbeiter gelöscht",
        description: `${fullName} wurde gelöscht. ${excelData ? "Excel-Backup wurde heruntergeladen und gespeichert." : "Keine Stundeneinträge vorhanden."}`,
      });

      setSelectedEmployee(null);
      fetchEmployees();
    } catch (error: any) {
      console.error("Error deleting employee:", error);
      toast({
        variant: "destructive",
        title: "Fehler beim Löschen",
        description: error.message || "Der Mitarbeiter konnte nicht gelöscht werden",
      });
    } finally {
      setDeleting(false);
    }
  };

  useEffect(() => {
    if (selectedEmployee) {
      setFormData(selectedEmployee);
    }
  }, [selectedEmployee]);

  const getWorkModelBadge = (wochenstunden: number | null) => {
    const w = wochenstunden ?? 40;
    const config: Record<number, { label: string; className: string }> = {
      40: { label: "40 Std. Vollzeit", className: "bg-primary/15 text-primary border-primary/30" },
      32: { label: "32 Std. Mi frei", className: "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/30 dark:text-blue-300" },
      20: { label: "20 Std. Teilzeit", className: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300" },
      10: { label: "10 Std. Geringfügig", className: "bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-300" },
    };
    const c = config[w] ?? config[40];
    return <Badge variant="outline" className={`text-xs font-medium ${c.className}`}>{c.label}</Badge>;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p>Lade Mitarbeiter...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <h1 className="text-3xl font-bold">Mitarbeiterverwaltung</h1>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowSizesDialog(true)}>
            <Shirt className="w-4 h-4 mr-2" />
            Arbeitskleidung/Schuhe Größen
          </Button>
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Neuer Mitarbeiter
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {employees.map((emp) => (
          <Card
            key={emp.id}
            className="cursor-pointer hover:shadow-lg transition-shadow"
            onClick={() => setSelectedEmployee(emp)}
          >
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="text-xs">
                      {emp.vorname[0]}{emp.nachname[0]}
                    </AvatarFallback>
                  </Avatar>
                  {emp.vorname} {emp.nachname}
                </CardTitle>
                {getWorkModelBadge(emp.wochenstunden)}
              </div>
              <CardDescription className="mt-1">{emp.position || "Mitarbeiter"}</CardDescription>
            </CardHeader>

            <CardContent className="pt-0">
              <div className="space-y-1.5 text-sm">
                {emp.email && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Mail className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{emp.email}</span>
                  </div>
                )}
                {emp.telefon && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Phone className="w-3.5 h-3.5 shrink-0" />
                    {emp.telefon}
                  </div>
                )}
                {emp.ort && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <MapPin className="w-3.5 h-3.5 shrink-0" />
                    {emp.plz} {emp.ort}
                  </div>
                )}
                {emp.eintritt_datum && (
                  <div className="text-muted-foreground text-xs pt-1">
                    Seit {format(new Date(emp.eintritt_datum), "dd.MM.yyyy")}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Detail-Dialog */}
      <Dialog open={!!selectedEmployee} onOpenChange={() => setSelectedEmployee(null)}>
        <DialogContent className="max-w-5xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>
              {selectedEmployee?.vorname} {selectedEmployee?.nachname}
            </DialogTitle>
          </DialogHeader>

          <Tabs defaultValue="stammdaten">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="stammdaten">
                <User className="w-4 h-4 mr-2" />
                Stammdaten
              </TabsTrigger>
              <TabsTrigger value="dokumente">
                <FileText className="w-4 h-4 mr-2" />
                Dokumente
              </TabsTrigger>
              <TabsTrigger value="stunden">
                <Clock className="w-4 h-4 mr-2" />
                Überstunden
              </TabsTrigger>
            </TabsList>

            {/* Tab 1: Stammdaten */}
            <TabsContent value="stammdaten">
              <ScrollArea className="h-[500px] pr-4">
                <form onSubmit={handleSaveEmployee} className="space-y-6">
                  <div>
                    <h3 className="text-lg font-semibold mb-3">Persönliche Daten</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Vorname *</Label>
                        <Input
                          value={formData.vorname || ""}
                          onChange={(e) => setFormData({ ...formData, vorname: e.target.value })}
                          required
                        />
                      </div>
                      <div>
                        <Label>Nachname *</Label>
                        <Input
                          value={formData.nachname || ""}
                          onChange={(e) => setFormData({ ...formData, nachname: e.target.value })}
                          required
                        />
                      </div>
                      <div>
                        <Label>Geburtsdatum</Label>
                        <Input
                          type="date"
                          value={formData.geburtsdatum || ""}
                          onChange={(e) => setFormData({ ...formData, geburtsdatum: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <h3 className="text-lg font-semibold mb-3">Kontaktdaten</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="col-span-2">
                        <Label>Adresse</Label>
                        <Input
                          value={formData.adresse || ""}
                          onChange={(e) => setFormData({ ...formData, adresse: e.target.value })}
                          placeholder="Straße und Hausnummer"
                        />
                      </div>
                      <div>
                        <Label>PLZ</Label>
                        <Input
                          value={formData.plz || ""}
                          onChange={(e) => setFormData({ ...formData, plz: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label>Ort</Label>
                        <Input
                          value={formData.ort || ""}
                          onChange={(e) => setFormData({ ...formData, ort: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label>Telefon</Label>
                        <Input
                          type="tel"
                          value={formData.telefon || ""}
                          onChange={(e) => setFormData({ ...formData, telefon: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label>E-Mail</Label>
                        <Input
                          type="email"
                          value={formData.email || ""}
                          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <h3 className="text-lg font-semibold mb-3">Beschäftigung</h3>
                    <div className="grid grid-cols-2 gap-4">
                      {/* Arbeitszeitmodell ganz oben – wichtigste Einstellung */}
                      <div className="col-span-2 p-3 rounded-lg border-2 border-primary/20 bg-primary/5">
                        <Label className="text-sm font-semibold text-primary">Arbeitszeitmodell *</Label>
                        <Select
                          value={String(formData.wochenstunden ?? 40)}
                          onValueChange={(v) => setFormData({ ...formData, wochenstunden: parseInt(v) })}
                        >
                          <SelectTrigger className="mt-1.5">
                            <SelectValue placeholder="Wählen..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="40">40 Std. – Vollzeit (Mo–Fr, 06:30–15:30)</SelectItem>
                            <SelectItem value="32">32 Std. – Teilzeit (Mo/Di/Do/Fr, Mi frei)</SelectItem>
                            <SelectItem value="20">20 Std. – Teilzeit (flexibel)</SelectItem>
                            <SelectItem value="10">10 Std. – Geringfügig (flexibel)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Position</Label>
                        <Input
                          value={formData.position || ""}
                          onChange={(e) => setFormData({ ...formData, position: e.target.value })}
                          placeholder="z.B. Tischler"
                        />
                      </div>
                      <div>
                        <Label>SV-Nummer</Label>
                        <Input
                          value={formData.sv_nummer || ""}
                          onChange={(e) => setFormData({ ...formData, sv_nummer: e.target.value })}
                          placeholder="1234 010180"
                        />
                      </div>
                      <div>
                        <Label>Eintrittsdatum</Label>
                        <Input
                          type="date"
                          value={formData.eintritt_datum || ""}
                          onChange={(e) => setFormData({ ...formData, eintritt_datum: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label>Austrittsdatum</Label>
                        <Input
                          type="date"
                          value={formData.austritt_datum || ""}
                          onChange={(e) => setFormData({ ...formData, austritt_datum: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label>Stundenlohn (€)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={formData.stundenlohn || ""}
                          onChange={(e) =>
                            setFormData({ ...formData, stundenlohn: parseFloat(e.target.value) })
                          }
                        />
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <h3 className="text-lg font-semibold mb-3">Bankverbindung</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="col-span-2">
                        <Label>IBAN</Label>
                        <Input
                          value={formData.iban || ""}
                          onChange={(e) => setFormData({ ...formData, iban: e.target.value })}
                          placeholder="AT12 3456 7890 1234 5678"
                        />
                      </div>
                      <div>
                        <Label>BIC</Label>
                        <Input
                          value={formData.bic || ""}
                          onChange={(e) => setFormData({ ...formData, bic: e.target.value })}
                          placeholder="BKAUATWW"
                        />
                      </div>
                      <div>
                        <Label>Bank</Label>
                        <Input
                          value={formData.bank_name || ""}
                          onChange={(e) => setFormData({ ...formData, bank_name: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <h3 className="text-lg font-semibold mb-3">Arbeitskleidung</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Kleidungsgröße</Label>
                        <Select
                          value={formData.kleidungsgroesse || ""}
                          onValueChange={(v) => setFormData({ ...formData, kleidungsgroesse: v })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Wählen..." />
                          </SelectTrigger>
                          <SelectContent>
                            {["S", "M", "L", "XL", "XXL", "XXXL"].map((size) => (
                              <SelectItem key={size} value={size}>
                                {size}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Schuhgröße</Label>
                        <Select
                          value={formData.schuhgroesse || ""}
                          onValueChange={(v) => setFormData({ ...formData, schuhgroesse: v })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Wählen..." />
                          </SelectTrigger>
                          <SelectContent>
                            {Array.from({ length: 17 }, (_, i) => 36 + i).map((size) => (
                              <SelectItem key={size} value={size.toString()}>
                                {size}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <Label>Notizen</Label>
                    <Textarea
                      value={formData.notizen || ""}
                      onChange={(e) => setFormData({ ...formData, notizen: e.target.value })}
                      rows={4}
                      placeholder="Sonstige Anmerkungen..."
                    />
                  </div>

                  <div className="flex justify-between">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button type="button" variant="destructive" size="sm" disabled={deleting}>
                          {deleting ? (
                            <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Wird gelöscht...</>
                          ) : (
                            <><Trash2 className="w-4 h-4 mr-2" />Mitarbeiter löschen</>
                          )}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Mitarbeiter endgültig löschen?</AlertDialogTitle>
                          <AlertDialogDescription>
                            <strong>{selectedEmployee?.vorname} {selectedEmployee?.nachname}</strong> wird unwiderruflich gelöscht.
                            <br /><br />
                            Folgendes passiert:
                            <ul className="list-disc pl-5 mt-2 space-y-1">
                              <li>Excel-Backup der Stundeneinträge wird heruntergeladen und in der Cloud gespeichert</li>
                              <li>Stundeneinträge werden anonymisiert (Name wird in Notizen gespeichert)</li>
                              <li>Regieberichte werden gelöscht</li>
                              <li>Benutzerkonto wird deaktiviert</li>
                            </ul>
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={handleDeleteEmployee}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Endgültig löschen
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" onClick={() => setSelectedEmployee(null)}>
                        Abbrechen
                      </Button>
                      <Button type="submit">Speichern</Button>
                    </div>
                  </div>
                </form>
              </ScrollArea>
            </TabsContent>

            {/* Tab 2: Dokumente */}
            <TabsContent value="dokumente">
              {selectedEmployee && (
                <EmployeeDocumentsManager
                  employeeId={selectedEmployee.id}
                  userId={selectedEmployee.user_id || selectedEmployee.id}
                />
              )}
            </TabsContent>

            {/* Tab 3: Überstunden */}
            <TabsContent value="stunden">
              <div className="space-y-4 p-4">
                <p className="text-sm text-muted-foreground">
                  Zur vollständigen Stundenauswertung wechseln Sie bitte zur Stundenauswertung-Seite.
                </p>
                <Button
                  onClick={() => {
                    if (selectedEmployee?.user_id) {
                      navigate(`/hours-report?employee=${selectedEmployee.user_id}`);
                      setSelectedEmployee(null);
                    } else {
                      toast({
                        title: "Keine User-ID",
                        description: "Dieser Mitarbeiter hat noch keinen Benutzer-Account",
                        variant: "destructive",
                      });
                    }
                  }}
                  className="w-full"
                >
                  <FileSpreadsheet className="w-4 h-4 mr-2" />
                  Zur Stundenauswertung
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Create-Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Neuer Mitarbeiter</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateEmployee} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Vorname *</Label>
                <Input
                  value={newEmployee.vorname}
                  onChange={(e) => setNewEmployee({ ...newEmployee, vorname: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label>Nachname *</Label>
                <Input
                  value={newEmployee.nachname}
                  onChange={(e) => setNewEmployee({ ...newEmployee, nachname: e.target.value })}
                  required
                />
              </div>
            </div>
            <div>
              <Label>E-Mail (optional)</Label>
              <Input
                type="email"
                value={newEmployee.email}
                onChange={(e) => setNewEmployee({ ...newEmployee, email: e.target.value })}
              />
            </div>
            <div className="p-3 rounded-lg border-2 border-primary/20 bg-primary/5">
              <Label className="text-sm font-semibold text-primary">Arbeitszeitmodell *</Label>
              <Select
                value={String(newEmployee.wochenstunden)}
                onValueChange={(v) => setNewEmployee({ ...newEmployee, wochenstunden: parseInt(v) })}
              >
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="40">40 Std. – Vollzeit (Mo–Fr)</SelectItem>
                  <SelectItem value="32">32 Std. – Teilzeit (Mi frei)</SelectItem>
                  <SelectItem value="20">20 Std. – Teilzeit (flexibel)</SelectItem>
                  <SelectItem value="10">10 Std. – Geringfügig (flexibel)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" className="w-full">
              Mitarbeiter anlegen
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Größen-Übersicht Dialog */}
      <Dialog open={showSizesDialog} onOpenChange={setShowSizesDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shirt className="w-5 h-5" />
              Arbeitskleidung & Schuhgrößen - Übersicht
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[600px]">
            <div className="rounded-md border">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Name</th>
                    <th className="px-4 py-3 text-left font-semibold">Position</th>
                    <th className="px-4 py-3 text-center font-semibold">Kleidungsgröße</th>
                    <th className="px-4 py-3 text-center font-semibold">Schuhgröße</th>
                  </tr>
                </thead>
                <tbody>
                  {employees
                    .sort((a, b) => a.nachname.localeCompare(b.nachname))
                    .map((emp, idx) => (
                      <tr 
                        key={emp.id} 
                        className={`border-t hover:bg-muted/30 cursor-pointer transition-colors ${
                          idx % 2 === 0 ? 'bg-background' : 'bg-muted/10'
                        }`}
                        onClick={() => {
                          setShowSizesDialog(false);
                          setSelectedEmployee(emp);
                        }}
                      >
                        <td className="px-4 py-3 font-medium">
                          {emp.vorname} {emp.nachname}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {emp.position || "Mitarbeiter"}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {emp.kleidungsgroesse ? (
                            <span className="inline-flex items-center justify-center w-12 h-8 rounded-md bg-primary/10 text-primary font-semibold">
                              {emp.kleidungsgroesse}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-sm">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {emp.schuhgroesse ? (
                            <span className="inline-flex items-center justify-center w-12 h-8 rounded-md bg-secondary/50 text-secondary-foreground font-semibold">
                              {emp.schuhgroesse}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-sm">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {employees.filter(e => !e.kleidungsgroesse && !e.schuhgroesse).length > 0 && (
              <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-md">
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  ℹ️ {employees.filter(e => !e.kleidungsgroesse && !e.schuhgroesse).length} Mitarbeiter 
                  haben noch keine Größenangaben. Klicke auf einen Mitarbeiter um die Daten zu ergänzen.
                </p>
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
