import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { format, addDays, startOfWeek, endOfWeek, isSameDay } from "date-fns";
import { de } from "date-fns/locale";
import { Truck, Wrench, Plus, ChevronLeft, ChevronRight, Calendar, Trash2, Edit } from "lucide-react";

type Project = { id: string; name: string; status: string };
type Profile = { id: string; vorname: string; nachname: string };
type Vehicle = { id: string; name: string; license_plate: string | null; type: string; is_active: boolean; notes: string | null };
type EquipmentItem = { id: string; name: string; type: string; serial_number: string | null; is_active: boolean; notes: string | null };
type Assignment = {
  id: string;
  project_id: string | null;
  employee_id: string;
  vehicle_id: string | null;
  assignment_date: string;
  start_time: string;
  end_time: string;
  role: string;
  notes: string | null;
};

export default function ResourcePlanning() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("planning");
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));

  const [projects, setProjects] = useState<Project[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [equipmentList, setEquipmentList] = useState<EquipmentItem[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);

  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [showVehicleDialog, setShowVehicleDialog] = useState(false);
  const [showEquipmentDialog, setShowEquipmentDialog] = useState(false);
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<Assignment | null>(null);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [editingEquipment, setEditingEquipment] = useState<EquipmentItem | null>(null);

  const [assignForm, setAssignForm] = useState({
    project_id: "", employee_ids: [] as string[], vehicle_id: "none",
    assignment_date: format(new Date(), "yyyy-MM-dd"),
    start_time: "07:00", end_time: "16:00", role: "Mitarbeiter", notes: "",
    // For edit mode only (single employee)
    employee_id: "",
  });
  const [vehicleForm, setVehicleForm] = useState({ name: "", license_plate: "", type: "Transporter", notes: "" });
  const [equipmentForm, setEquipmentForm] = useState({ name: "", type: "Werkzeug", serial_number: "", notes: "" });
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectPlz, setNewProjectPlz] = useState("");
  const [newProjectAddress, setNewProjectAddress] = useState("");

  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 5 }, (_, i) => addDays(weekStart, i));

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [pRes, prRes, vRes, eRes] = await Promise.all([
      supabase.from("projects").select("id, name, status").eq("status", "aktiv").order("name"),
      supabase.from("profiles").select("id, vorname, nachname").eq("is_active", true).order("nachname"),
      supabase.from("vehicles").select("*").eq("is_active", true).order("name"),
      supabase.from("equipment").select("*").eq("is_active", true).order("name"),
    ]);
    if (pRes.data) setProjects(pRes.data);
    if (prRes.data) setProfiles(prRes.data);
    if (vRes.data) setVehicles(vRes.data);
    if (eRes.data) setEquipmentList(eRes.data);
    setLoading(false);
  }, []);

  const fetchAssignments = useCallback(async () => {
    const from = format(weekStart, "yyyy-MM-dd");
    const to = format(weekEnd, "yyyy-MM-dd");
    const { data } = await supabase.from("resource_assignments").select("*")
      .gte("assignment_date", from).lte("assignment_date", to).order("assignment_date");
    if (data) setAssignments(data);
  }, [weekStart, weekEnd]);

  useEffect(() => {
    const check = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { navigate("/auth"); return; }
      const { data: r } = await supabase.from("user_roles").select("role").eq("user_id", user.id).single();
      if (!r || r.role !== "administrator") navigate("/");
    };
    check();
    fetchData();
  }, [fetchData, navigate]);

  useEffect(() => { fetchAssignments(); }, [fetchAssignments]);

  const handleSaveAssignment = async () => {
    if (!assignForm.assignment_date) {
      toast({ variant: "destructive", title: "Fehler", description: "Datum ist ein Pflichtfeld." });
      return;
    }

    const basePayload = {
      project_id: assignForm.project_id || null,
      vehicle_id: assignForm.vehicle_id && assignForm.vehicle_id !== "none" ? assignForm.vehicle_id : null,
      assignment_date: assignForm.assignment_date,
      start_time: assignForm.start_time, end_time: assignForm.end_time,
      role: assignForm.role, notes: assignForm.notes || null,
    };

    if (editingAssignment) {
      // Edit mode: single employee
      if (!assignForm.employee_id) {
        toast({ variant: "destructive", title: "Fehler", description: "Mitarbeiter ist ein Pflichtfeld." });
        return;
      }
      const { error } = await supabase.from("resource_assignments").update({ ...basePayload, employee_id: assignForm.employee_id }).eq("id", editingAssignment.id);
      if (error) { toast({ variant: "destructive", title: "Fehler", description: error.message }); return; }
      toast({ title: "Aktualisiert" });
    } else {
      // Create mode: multiple employees
      if (assignForm.employee_ids.length === 0) {
        toast({ variant: "destructive", title: "Fehler", description: "Mindestens ein Mitarbeiter muss ausgewählt werden." });
        return;
      }
      const entries = assignForm.employee_ids.map(eid => ({ ...basePayload, employee_id: eid }));
      const { error } = await supabase.from("resource_assignments").insert(entries);
      if (error) { toast({ variant: "destructive", title: "Fehler", description: error.message }); return; }
      toast({ title: `${entries.length} Einteilung${entries.length > 1 ? "en" : ""} erstellt` });
    }
    setShowAssignDialog(false); setEditingAssignment(null); resetAssignForm(); fetchAssignments();
  };

  const handleDeleteAssignment = async (id: string) => {
    if (!confirm("Einteilung löschen?")) return;
    await supabase.from("resource_assignments").delete().eq("id", id);
    fetchAssignments();
  };

  const resetAssignForm = () => setAssignForm({ project_id: "", employee_ids: [], employee_id: "", vehicle_id: "none", assignment_date: format(new Date(), "yyyy-MM-dd"), start_time: "07:00", end_time: "16:00", role: "Mitarbeiter", notes: "" });

  const handleCreateProject = async () => {
    if (!newProjectName.trim() || !newProjectPlz.trim()) {
      toast({ variant: "destructive", title: "Fehler", description: "Projektname und PLZ sind Pflichtfelder." });
      return;
    }
    if (!/^\d{4,5}$/.test(newProjectPlz)) {
      toast({ variant: "destructive", title: "Fehler", description: "PLZ muss 4-5 Ziffern haben." });
      return;
    }
    const { data, error } = await supabase.from("projects").insert({
      name: newProjectName.trim(),
      plz: newProjectPlz.trim(),
      adresse: newProjectAddress.trim() || null,
      status: "aktiv",
    }).select("id").single();
    if (error) { toast({ variant: "destructive", title: "Fehler", description: error.message }); return; }
    toast({ title: "Projekt erstellt" });
    setShowNewProjectDialog(false);
    setNewProjectName(""); setNewProjectPlz(""); setNewProjectAddress("");
    await fetchData();
    if (data) setAssignForm(p => ({ ...p, project_id: data.id }));
  };

  const handleSaveVehicle = async () => {
    if (!vehicleForm.name) { toast({ variant: "destructive", title: "Fehler", description: "Name ist Pflichtfeld." }); return; }
    if (editingVehicle) {
      await supabase.from("vehicles").update(vehicleForm).eq("id", editingVehicle.id);
    } else {
      await supabase.from("vehicles").insert({ ...vehicleForm, is_active: true });
    }
    toast({ title: "Gespeichert" }); setShowVehicleDialog(false); setEditingVehicle(null);
    setVehicleForm({ name: "", license_plate: "", type: "Transporter", notes: "" }); fetchData();
  };

  const handleSaveEquipment = async () => {
    if (!equipmentForm.name) { toast({ variant: "destructive", title: "Fehler", description: "Name ist Pflichtfeld." }); return; }
    if (editingEquipment) {
      await supabase.from("equipment").update(equipmentForm).eq("id", editingEquipment.id);
    } else {
      await supabase.from("equipment").insert({ ...equipmentForm, is_active: true });
    }
    toast({ title: "Gespeichert" }); setShowEquipmentDialog(false); setEditingEquipment(null);
    setEquipmentForm({ name: "", type: "Werkzeug", serial_number: "", notes: "" }); fetchData();
  };

  const getProjectName = (id: string | null) => { if (!id) return null; return projects.find(p => p.id === id)?.name || null; };
  const getEmployeeName = (id: string) => { const p = profiles.find(x => x.id === id); return p ? `${p.vorname} ${p.nachname}` : "–"; };
  const getVehicleName = (id: string | null) => { if (!id) return null; return vehicles.find(v => v.id === id)?.name || null; };
  const getAssignmentsForDay = (day: Date) => assignments.filter(a => isSameDay(new Date(a.assignment_date + "T00:00:00"), day));

  const openAssignForDay = (day: Date) => {
    resetAssignForm();
    setAssignForm(prev => ({ ...prev, assignment_date: format(day, "yyyy-MM-dd") }));
    setEditingAssignment(null); setShowAssignDialog(true);
  };

  const openEditAssignment = (a: Assignment) => {
    setAssignForm({ project_id: a.project_id || "", employee_id: a.employee_id, employee_ids: [], vehicle_id: a.vehicle_id || "none", assignment_date: a.assignment_date, start_time: a.start_time, end_time: a.end_time, role: a.role, notes: a.notes || "" });
    setEditingAssignment(a); setShowAssignDialog(true);
  };

  const toggleEmployee = (id: string) => {
    setAssignForm(prev => ({
      ...prev,
      employee_ids: prev.employee_ids.includes(id)
        ? prev.employee_ids.filter(e => e !== id)
        : [...prev.employee_ids, id],
    }));
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><p>Lädt...</p></div>;

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title="Disponierung" />
      <main className="container mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-6 lg:py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3 mb-6">
            <TabsTrigger value="planning" className="text-xs sm:text-sm">
              <Calendar className="w-4 h-4 mr-1 sm:mr-2" /><span className="hidden sm:inline">Wochenplanung</span><span className="sm:hidden">Planung</span>
            </TabsTrigger>
            <TabsTrigger value="vehicles" className="text-xs sm:text-sm"><Truck className="w-4 h-4 mr-1 sm:mr-2" />Fahrzeuge</TabsTrigger>
            <TabsTrigger value="equipment" className="text-xs sm:text-sm"><Wrench className="w-4 h-4 mr-1 sm:mr-2" />Geräte</TabsTrigger>
          </TabsList>

          <TabsContent value="planning">
            <div className="flex items-center justify-between mb-4 gap-2">
              <Button variant="outline" size="sm" onClick={() => setWeekStart(addDays(weekStart, -7))}>
                <ChevronLeft className="w-4 h-4" /><span className="hidden sm:inline ml-1">Vorwoche</span>
              </Button>
              <h2 className="text-sm sm:text-lg font-semibold text-center">
                {format(weekStart, "dd.MM.", { locale: de })} – {format(weekEnd, "dd.MM.yyyy", { locale: de })}
              </h2>
              <Button variant="outline" size="sm" onClick={() => setWeekStart(addDays(weekStart, 7))}>
                <span className="hidden sm:inline mr-1">Nächste</span><ChevronRight className="w-4 h-4" />
              </Button>
            </div>

            <Button className="w-full sm:w-auto mb-4" onClick={() => { resetAssignForm(); setEditingAssignment(null); setShowAssignDialog(true); }}>
              <Plus className="w-4 h-4 mr-2" />Neue Einteilung
            </Button>

            {/* Desktop week grid */}
            <div className="hidden md:grid md:grid-cols-5 gap-3">
              {weekDays.map(day => {
                const da = getAssignmentsForDay(day);
                const isToday = isSameDay(day, new Date());
                return (
                  <Card key={day.toISOString()} className={isToday ? "border-primary shadow-md" : ""}>
                    <CardHeader className="pb-2 px-3 pt-3">
                      <CardTitle className="text-sm flex items-center justify-between">
                        <span>{format(day, "EEEE", { locale: de })}</span>
                        <Badge variant={isToday ? "default" : "secondary"} className="text-xs">{format(day, "dd.MM.")}</Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-3 pb-3 space-y-2">
                      {da.length === 0 ? <p className="text-xs text-muted-foreground text-center py-2">Keine Einteilungen</p> : da.map(a => (
                        <div key={a.id} className="p-2 rounded border bg-accent/30 text-xs space-y-1 group relative">
                          <p className="font-semibold truncate">{getEmployeeName(a.employee_id)}</p>
                          {getProjectName(a.project_id) && <p className="text-muted-foreground truncate">{getProjectName(a.project_id)}</p>}
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <span>{a.start_time}–{a.end_time}</span>
                            {getVehicleName(a.vehicle_id) && <Badge variant="outline" className="text-[10px] px-1 py-0"><Truck className="w-3 h-3 mr-0.5" />{getVehicleName(a.vehicle_id)}</Badge>}
                          </div>
                          <div className="absolute top-1 right-1 hidden group-hover:flex gap-1">
                            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => openEditAssignment(a)}><Edit className="w-3 h-3" /></Button>
                            <Button variant="ghost" size="icon" className="h-5 w-5 text-destructive" onClick={() => handleDeleteAssignment(a.id)}><Trash2 className="w-3 h-3" /></Button>
                          </div>
                        </div>
                      ))}
                      <Button variant="ghost" size="sm" className="w-full text-xs h-7" onClick={() => openAssignForDay(day)}><Plus className="w-3 h-3 mr-1" />Hinzufügen</Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Mobile day list */}
            <div className="md:hidden space-y-3">
              {weekDays.map(day => {
                const da = getAssignmentsForDay(day);
                const isToday = isSameDay(day, new Date());
                return (
                  <Card key={day.toISOString()} className={isToday ? "border-primary shadow-md" : ""}>
                    <CardHeader className="pb-2 px-3 pt-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm">{format(day, "EEEE, dd.MM.", { locale: de })}</CardTitle>
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => openAssignForDay(day)}><Plus className="w-3 h-3 mr-1" />Neu</Button>
                      </div>
                    </CardHeader>
                    <CardContent className="px-3 pb-3">
                      {da.length === 0 ? <p className="text-xs text-muted-foreground text-center py-2">Keine Einteilungen</p> : (
                        <div className="space-y-2">
                          {da.map(a => (
                            <div key={a.id} className="flex items-center justify-between p-2 rounded border bg-accent/30">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{getEmployeeName(a.employee_id)}</p>
                                {getProjectName(a.project_id) && <p className="text-xs text-muted-foreground truncate">{getProjectName(a.project_id)}</p>}
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="text-xs text-muted-foreground">{a.start_time}–{a.end_time}</span>
                                  {getVehicleName(a.vehicle_id) && <Badge variant="outline" className="text-[10px] px-1 py-0"><Truck className="w-3 h-3 mr-0.5" />{getVehicleName(a.vehicle_id)}</Badge>}
                                </div>
                              </div>
                              <div className="flex gap-1 ml-2">
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditAssignment(a)}><Edit className="w-3.5 h-3.5" /></Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDeleteAssignment(a.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>

          <TabsContent value="vehicles">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg sm:text-xl font-semibold">Fahrzeuge</h2>
              <Button size="sm" onClick={() => { setEditingVehicle(null); setVehicleForm({ name: "", license_plate: "", type: "Transporter", notes: "" }); setShowVehicleDialog(true); }}>
                <Plus className="w-4 h-4 mr-2" />Fahrzeug
              </Button>
            </div>
            {vehicles.length === 0 ? (
              <Card><CardContent className="py-8 text-center text-muted-foreground"><Truck className="w-12 h-12 mx-auto mb-2 opacity-50" /><p>Noch keine Fahrzeuge angelegt</p></CardContent></Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {vehicles.map(v => (
                  <Card key={v.id}><CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center"><Truck className="w-5 h-5 text-primary" /></div>
                        <div>
                          <p className="font-semibold">{v.name}</p>
                          {v.license_plate && <p className="text-sm text-muted-foreground">{v.license_plate}</p>}
                          <Badge variant="secondary" className="text-xs mt-1">{v.type}</Badge>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditingVehicle(v); setVehicleForm({ name: v.name, license_plate: v.license_plate || "", type: v.type, notes: v.notes || "" }); setShowVehicleDialog(true); }}><Edit className="w-4 h-4" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={async () => { if (!confirm("Fahrzeug deaktivieren?")) return; await supabase.from("vehicles").update({ is_active: false }).eq("id", v.id); fetchData(); }}><Trash2 className="w-4 h-4" /></Button>
                      </div>
                    </div>
                  </CardContent></Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="equipment">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg sm:text-xl font-semibold">Geräte & Werkzeuge</h2>
              <Button size="sm" onClick={() => { setEditingEquipment(null); setEquipmentForm({ name: "", type: "Werkzeug", serial_number: "", notes: "" }); setShowEquipmentDialog(true); }}>
                <Plus className="w-4 h-4 mr-2" />Gerät
              </Button>
            </div>
            {equipmentList.length === 0 ? (
              <Card><CardContent className="py-8 text-center text-muted-foreground"><Wrench className="w-12 h-12 mx-auto mb-2 opacity-50" /><p>Noch keine Geräte angelegt</p></CardContent></Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {equipmentList.map(e => (
                  <Card key={e.id}><CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg bg-accent/10 flex items-center justify-center"><Wrench className="w-5 h-5 text-accent" /></div>
                        <div>
                          <p className="font-semibold">{e.name}</p>
                          {e.serial_number && <p className="text-sm text-muted-foreground">SN: {e.serial_number}</p>}
                          <Badge variant="secondary" className="text-xs mt-1">{e.type}</Badge>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditingEquipment(e); setEquipmentForm({ name: e.name, type: e.type, serial_number: e.serial_number || "", notes: e.notes || "" }); setShowEquipmentDialog(true); }}><Edit className="w-4 h-4" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={async () => { if (!confirm("Gerät deaktivieren?")) return; await supabase.from("equipment").update({ is_active: false }).eq("id", e.id); fetchData(); }}><Trash2 className="w-4 h-4" /></Button>
                      </div>
                    </div>
                  </CardContent></Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>

      {/* Assignment Dialog */}
      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <DialogContent className="max-w-[95vw] sm:max-w-lg">
          <DialogHeader><DialogTitle>{editingAssignment ? "Einteilung bearbeiten" : "Neue Einteilung"}</DialogTitle></DialogHeader>
          <ScrollArea className="max-h-[70vh]">
            <div className="space-y-4 pr-2">
              <div><Label>Datum *</Label><Input type="date" value={assignForm.assignment_date} onChange={e => setAssignForm(p => ({ ...p, assignment_date: e.target.value }))} /></div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label>Projekt</Label>
                  <Button type="button" variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => setShowNewProjectDialog(true)}>
                    <Plus className="w-3 h-3 mr-1" />Neues Projekt
                  </Button>
                </div>
                <Select value={assignForm.project_id || "none"} onValueChange={v => setAssignForm(p => ({ ...p, project_id: v === "none" ? "" : v }))}>
                  <SelectTrigger><SelectValue placeholder="Projekt wählen (optional)..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Kein Projekt</SelectItem>
                    {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* Employee selection */}
              {editingAssignment ? (
                <div><Label>Mitarbeiter *</Label>
                  <Select value={assignForm.employee_id} onValueChange={v => setAssignForm(p => ({ ...p, employee_id: v }))}>
                    <SelectTrigger><SelectValue placeholder="Mitarbeiter wählen..." /></SelectTrigger>
                    <SelectContent>{profiles.map(p => <SelectItem key={p.id} value={p.id}>{p.vorname} {p.nachname}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              ) : (
                <div>
                  <Label>Mitarbeiter * {assignForm.employee_ids.length > 0 && <span className="text-muted-foreground font-normal">({assignForm.employee_ids.length} ausgewählt)</span>}</Label>
                  <div className="border rounded-md mt-1 max-h-[180px] overflow-y-auto">
                    {profiles.map(p => (
                      <label key={p.id} className="flex items-center gap-3 px-3 py-2 hover:bg-accent/50 cursor-pointer border-b last:border-b-0">
                        <Checkbox
                          checked={assignForm.employee_ids.includes(p.id)}
                          onCheckedChange={() => toggleEmployee(p.id)}
                        />
                        <span className="text-sm">{p.vorname} {p.nachname}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div><Label>Fahrzeug</Label>
                <Select value={assignForm.vehicle_id} onValueChange={v => setAssignForm(p => ({ ...p, vehicle_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Optional..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Kein Fahrzeug</SelectItem>
                    {vehicles.map(v => <SelectItem key={v.id} value={v.id}>{v.name} {v.license_plate ? `(${v.license_plate})` : ""}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Von</Label><Input type="time" value={assignForm.start_time} onChange={e => setAssignForm(p => ({ ...p, start_time: e.target.value }))} /></div>
                <div><Label>Bis</Label><Input type="time" value={assignForm.end_time} onChange={e => setAssignForm(p => ({ ...p, end_time: e.target.value }))} /></div>
              </div>
              <div><Label>Rolle</Label>
                <Select value={assignForm.role} onValueChange={v => setAssignForm(p => ({ ...p, role: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Vorarbeiter">Vorarbeiter</SelectItem>
                    <SelectItem value="Mitarbeiter">Mitarbeiter</SelectItem>
                    <SelectItem value="Lehrling">Lehrling</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Notizen</Label><Textarea value={assignForm.notes} onChange={e => setAssignForm(p => ({ ...p, notes: e.target.value }))} rows={2} placeholder="Optional..." /></div>
            </div>
          </ScrollArea>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setShowAssignDialog(false); setEditingAssignment(null); }}>Abbrechen</Button>
            <Button onClick={handleSaveAssignment}>{editingAssignment ? "Speichern" : "Einteilen"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Project Dialog */}
      <Dialog open={showNewProjectDialog} onOpenChange={setShowNewProjectDialog}>
        <DialogContent className="max-w-[95vw] sm:max-w-md">
          <DialogHeader><DialogTitle>Neues Projekt erstellen</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Projektname *</Label><Input value={newProjectName} onChange={e => setNewProjectName(e.target.value)} placeholder="z.B. Küche Müller" /></div>
            <div><Label>PLZ *</Label><Input value={newProjectPlz} onChange={e => setNewProjectPlz(e.target.value)} maxLength={5} placeholder="z.B. 5020" /></div>
            <div><Label>Adresse</Label><Input value={newProjectAddress} onChange={e => setNewProjectAddress(e.target.value)} placeholder="Optional" /></div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowNewProjectDialog(false)}>Abbrechen</Button>
            <Button onClick={handleCreateProject}>Erstellen</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Vehicle Dialog */}
      <Dialog open={showVehicleDialog} onOpenChange={setShowVehicleDialog}>
        <DialogContent className="max-w-[95vw] sm:max-w-md">
          <DialogHeader><DialogTitle>{editingVehicle ? "Fahrzeug bearbeiten" : "Neues Fahrzeug"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Name *</Label><Input value={vehicleForm.name} onChange={e => setVehicleForm(p => ({ ...p, name: e.target.value }))} placeholder="z.B. VW Crafter" /></div>
            <div><Label>Kennzeichen</Label><Input value={vehicleForm.license_plate} onChange={e => setVehicleForm(p => ({ ...p, license_plate: e.target.value }))} placeholder="z.B. SB-123AB" /></div>
            <div><Label>Typ</Label>
              <Select value={vehicleForm.type} onValueChange={v => setVehicleForm(p => ({ ...p, type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Transporter">Transporter</SelectItem><SelectItem value="PKW">PKW</SelectItem>
                  <SelectItem value="LKW">LKW</SelectItem><SelectItem value="Anhänger">Anhänger</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Notizen</Label><Textarea value={vehicleForm.notes} onChange={e => setVehicleForm(p => ({ ...p, notes: e.target.value }))} rows={2} /></div>
          </div>
          <DialogFooter className="gap-2"><Button variant="outline" onClick={() => setShowVehicleDialog(false)}>Abbrechen</Button><Button onClick={handleSaveVehicle}>Speichern</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Equipment Dialog */}
      <Dialog open={showEquipmentDialog} onOpenChange={setShowEquipmentDialog}>
        <DialogContent className="max-w-[95vw] sm:max-w-md">
          <DialogHeader><DialogTitle>{editingEquipment ? "Gerät bearbeiten" : "Neues Gerät"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Name *</Label><Input value={equipmentForm.name} onChange={e => setEquipmentForm(p => ({ ...p, name: e.target.value }))} placeholder="z.B. Tischkreissäge" /></div>
            <div><Label>Typ</Label>
              <Select value={equipmentForm.type} onValueChange={v => setEquipmentForm(p => ({ ...p, type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Werkzeug">Werkzeug</SelectItem><SelectItem value="Maschine">Maschine</SelectItem>
                  <SelectItem value="Messgerät">Messgerät</SelectItem><SelectItem value="Sonstiges">Sonstiges</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Seriennummer</Label><Input value={equipmentForm.serial_number} onChange={e => setEquipmentForm(p => ({ ...p, serial_number: e.target.value }))} /></div>
            <div><Label>Notizen</Label><Textarea value={equipmentForm.notes} onChange={e => setEquipmentForm(p => ({ ...p, notes: e.target.value }))} rows={2} /></div>
          </div>
          <DialogFooter className="gap-2"><Button variant="outline" onClick={() => setShowEquipmentDialog(false)}>Abbrechen</Button><Button onClick={handleSaveEquipment}>Speichern</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
