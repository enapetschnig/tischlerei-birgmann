import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Session, User } from "@supabase/supabase-js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Clock, FolderKanban, Users, BarChart3, LogOut, FileText, Info, User as UserIcon, Zap, CalendarDays, MapPin } from "lucide-react";
import { startOfWeek, endOfWeek, addDays, isSameDay, format } from "date-fns";
import { de } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import { useOnboarding } from "@/contexts/OnboardingContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import ChangePasswordDialog from "@/components/ChangePasswordDialog";
import NotificationBell from "@/components/NotificationBell";

type Project = {
  id: string;
  name: string;
  status: string;
  updated_at: string;
};

type WeekAssignment = {
  id: string;
  assignment_date: string;
  start_time: string;
  end_time: string;
  project_id: string | null;
  vehicle_id: string | null;
  role: string;
  notes: string | null;
  projects: { name: string } | null;
  vehicles: { name: string } | null;
};

export default function Index() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekAssignments, setWeekAssignments] = useState<WeekAssignment[]>([]);
  const [isActivated, setIsActivated] = useState<boolean | null>(null);
  const { handleRestartInstallGuide } = useOnboarding();

  const fetchProjects = async () => {
    const { data } = await supabase
      .from("projects")
      .select("id, name, status, updated_at")
      .eq("status", "aktiv")
      .order("updated_at", { ascending: false })
      .limit(5);

    if (data) {
      setProjects(data);
    }
  };

  const fetchWeekAssignments = async (userId: string) => {
    const now = new Date();
    const weekStartDate = startOfWeek(now, { weekStartsOn: 1 });
    const weekEndDate = endOfWeek(now, { weekStartsOn: 1 });
    const { data } = await supabase
      .from("resource_assignments")
      .select("id, assignment_date, start_time, end_time, project_id, vehicle_id, role, notes, projects(name), vehicles(name)")
      .eq("employee_id", userId)
      .gte("assignment_date", format(weekStartDate, "yyyy-MM-dd"))
      .lte("assignment_date", format(weekEndDate, "yyyy-MM-dd"))
      .order("assignment_date");
    if (data) setWeekAssignments(data as any);
  };

  const loadForUser = async (userId: string) => {
    // 1) Activation + name
    const profileReq = supabase
      .from("profiles")
      .select("vorname, nachname, is_active")
      .eq("id", userId)
      .maybeSingle();

    // 2) Role
    const roleReq = supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .maybeSingle();

    const [{ data: profileData }, { data: roleData }] = await Promise.all([profileReq, roleReq]);

    // Falls Profil noch nicht existiert (Trigger hat noch nicht ausgeführt), trotzdem weitermachen
    setIsActivated(true);
    
    if (profileData) {
      setUserName(`${profileData.vorname} ${profileData.nachname}`.trim());
    } else {
      // Fallback: User-Metadaten verwenden
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.user_metadata) {
        setUserName(`${user.user_metadata.vorname || ''} ${user.user_metadata.nachname || ''}`.trim() || 'Neuer Benutzer');
      }
    }

    const role = roleData?.role ?? null;
    setUserRole(role);

    await Promise.all([
      fetchProjects(),
      fetchWeekAssignments(userId),
    ]);

    setLoading(false);
  };

  useEffect(() => {
    let isMounted = true;

    const handleSession = async (nextSession: Session | null) => {
      if (!isMounted) return;

      setSession(nextSession);
      setUser(nextSession?.user ?? null);

      if (!nextSession?.user) {
        setIsActivated(null);
        setUserRole(null);
        setUserName("");
        setProjects([]);
        setRecentEntries([]);
        setLoading(false);
        navigate("/auth");
        return;
      }

      // Block any UI until activation is verified
      setLoading(true);
      setIsActivated(null);

      await loadForUser(nextSession.user.id);
    };

    // Listen for auth changes FIRST
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      // Never run async supabase calls inside this callback.
      window.setTimeout(() => {
        void handleSession(nextSession);
      }, 0);
    });

    // THEN check initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      window.setTimeout(() => {
        void handleSession(session);
      }, 0);
    });

    // Realtime subscription for projects
    const projectsChannel = supabase
      .channel("dashboard-projects")
      .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, () => {
        fetchProjects();
      })
      .subscribe();

    // Realtime subscription for resource assignments (Disponierung)
    const assignmentsChannel = supabase
      .channel("dashboard-assignments")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "resource_assignments",
          filter: user ? `employee_id=eq.${user.id}` : undefined,
        },
        () => {
          if (user) fetchWeekAssignments(user.id);
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      subscription.unsubscribe();
      supabase.removeChannel(projectsChannel);
      supabase.removeChannel(assignmentsChannel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  const handleLogout = async () => {
    await supabase.auth.signOut({ scope: "global" });
    navigate("/auth");
  };

  useEffect(() => {
    if (!loading && !user) {
      navigate("/auth");
    }
  }, [loading, user, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Lädt...</p>
      </div>
    );
  }

  if (!user) {
    navigate("/auth");
    return null;
  }

  const isAdmin = userRole === "administrator";

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card sticky top-0 z-50 shadow-sm">
        <div className="container mx-auto px-3 sm:px-4 lg:px-6 py-3 sm:py-4">
          <div className="flex justify-between items-center gap-3">
            <div className="flex items-center gap-2 sm:gap-3">
              <img src="/birgmann-logo.png" alt="Tischlerei Birgmann" className="h-10 sm:h-12 w-auto" />
              <div className="hidden sm:block h-8 w-px bg-border" />
              <div className="flex flex-col">
                <span className="text-xs sm:text-sm text-muted-foreground">Hallo</span>
                <span className="text-sm sm:text-base font-semibold">{userName || "Benutzer"}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
            <NotificationBell />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <UserIcon className="h-4 w-4 mr-2" />
                  <span className="hidden sm:inline">Menü</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Mein Account</DropdownMenuLabel>
                <DropdownMenuSeparator />
                
                <DropdownMenuItem onClick={handleRestartInstallGuide}>
                  <Info className="mr-2 h-4 w-4" />
                  <span>App zum Startbildschirm hinzufügen</span>
                </DropdownMenuItem>
                
                <DropdownMenuSeparator />

                <ChangePasswordDialog />
                
                <DropdownMenuSeparator />
                
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Abmelden</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-6 lg:py-8">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-2">
            {isAdmin ? "Admin Dashboard" : "Mein Dashboard"}
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground">
            {isAdmin 
              ? "Verwaltung aller Projekte und Mitarbeiter" 
              : "Zeiterfassung und Projektdokumentation"}
          </p>
        </div>

        {/* Weekly Assignments Banner */}
        {weekAssignments.length > 0 && (
          <Card className="mb-6 border-primary/30 bg-primary/5">
            <CardHeader className="pb-2 px-4 pt-4">
              <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                <CalendarDays className="w-5 h-5 text-primary" />
                Meine Einteilungen diese Woche
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="space-y-2">
                {(() => {
                  const now = new Date();
                  const weekStartDate = startOfWeek(now, { weekStartsOn: 1 });
                  const weekDays = Array.from({ length: 5 }, (_, i) => addDays(weekStartDate, i));
                  return weekDays.map(day => {
                    const dayAssignments = weekAssignments.filter(a => isSameDay(new Date(a.assignment_date + "T00:00:00"), day));
                    if (dayAssignments.length === 0) return null;
                    const isToday = isSameDay(day, now);
                    return (
                      <div key={day.toISOString()} className={`rounded-lg p-3 ${isToday ? "bg-primary/15 border border-primary/40 ring-1 ring-primary/20" : "bg-background/80 border"}`}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-sm font-semibold ${isToday ? "text-primary" : ""}`}>
                            {format(day, "EEEE, dd.MM.", { locale: de })}
                          </span>
                          {isToday && <span className="text-[10px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full font-medium">Heute</span>}
                        </div>
                        {dayAssignments.map(a => (
                          <div key={a.id} className="flex items-center gap-3 text-sm mt-1">
                            <span className="font-mono text-xs text-muted-foreground">{a.start_time}–{a.end_time}</span>
                            {a.projects?.name && (
                              <span className="flex items-center gap-1">
                                <MapPin className="w-3 h-3 text-muted-foreground" />
                                <span className="font-medium">{a.projects.name}</span>
                              </span>
                            )}
                            {a.vehicles?.name && (
                              <span className="text-xs text-muted-foreground">({a.vehicles.name})</span>
                            )}
                            {a.notes && (
                              <span className="text-xs text-muted-foreground italic">{a.notes}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    );
                  });
                })()}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Main Actions Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 lg:gap-6">
          {/* Zeiterfassung - Für alle */}
          <Card 
            className="cursor-pointer hover:shadow-lg transition-all hover:border-primary/50" 
            onClick={() => navigate("/time-tracking")}
          >
            <CardHeader className="space-y-2 pb-3">
              <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <Clock className="h-6 w-6 text-primary" />
              </div>
              <CardTitle className="text-lg sm:text-xl">Zeiterfassung</CardTitle>
              <CardDescription className="text-sm">
                Stunden auf Projekte buchen
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" size="sm">Stunden erfassen</Button>
            </CardContent>
          </Card>

          {/* Projekte - Für alle */}
          <Card 
            className="cursor-pointer hover:shadow-lg transition-all hover:border-primary/50" 
            onClick={() => navigate("/projects")}
          >
            <CardHeader className="space-y-2 pb-3">
              <div className="h-12 w-12 rounded-lg bg-accent/10 flex items-center justify-center">
                <FolderKanban className="h-6 w-6 text-accent" />
              </div>
              <CardTitle className="text-lg sm:text-xl">Projekte</CardTitle>
              <CardDescription className="text-sm">
                {isAdmin ? "Bauvorhaben & Dokumentation" : "Pläne, Bilder, Berichte, etc. hochladen"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" size="sm" variant="secondary">Projekte öffnen</Button>
            </CardContent>
          </Card>

          {/* Meine Stunden - Für alle */}
          <Card 
            className="cursor-pointer hover:shadow-lg transition-all hover:border-primary/50" 
            onClick={() => navigate("/my-hours")}
          >
            <CardHeader className="space-y-2 pb-3">
              <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <BarChart3 className="h-6 w-6 text-primary" />
              </div>
              <CardTitle className="text-lg sm:text-xl">Meine Stunden</CardTitle>
              <CardDescription className="text-sm">
                {isAdmin ? "Eigene gebuchte Zeiten anzeigen & bearbeiten" : "Übersicht gebuchter Zeiten"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" size="sm" variant="outline">Anzeigen</Button>
            </CardContent>
          </Card>

          {/* Regieberichte - Für alle */}
          <Card 
            className="cursor-pointer hover:shadow-lg transition-all hover:border-primary/50" 
            onClick={() => navigate("/disturbances")}
          >
            <CardHeader className="space-y-2 pb-3">
              <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <Zap className="h-6 w-6 text-primary" />
              </div>
              <CardTitle className="text-lg sm:text-xl">Regiearbeiten</CardTitle>
              <CardDescription className="text-sm">
                Service-Einsätze dokumentieren
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" size="sm" variant="outline">Regiearbeiten öffnen</Button>
            </CardContent>
          </Card>


          {/* Meine Dokumente - Für Mitarbeiter */}
          {!isAdmin && (
            <Card 
              className="cursor-pointer hover:shadow-lg transition-all hover:border-primary/50" 
              onClick={() => navigate("/my-documents")}
            >
              <CardHeader className="space-y-2 pb-3">
                <div className="h-12 w-12 rounded-lg bg-accent/10 flex items-center justify-center">
                  <FileText className="h-6 w-6 text-accent" />
                </div>
                <CardTitle className="text-lg sm:text-xl">Meine Dokumente</CardTitle>
                <CardDescription className="text-sm">
                  Lohnzettel & Krankmeldungen
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full" size="sm" variant="outline">Dokumente öffnen</Button>
              </CardContent>
            </Card>
          )}


          {/* Admin: Stundenauswertung */}
          {isAdmin && (
            <Card 
              className="cursor-pointer hover:shadow-lg transition-all hover:border-primary/50" 
              onClick={() => navigate("/hours-report")}
            >
              <CardHeader className="space-y-2 pb-3">
                <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                  <BarChart3 className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-lg sm:text-xl">Stundenauswertung</CardTitle>
                <CardDescription className="text-sm">
                  Auswertung der Projektstunden
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full" size="sm">Auswerten</Button>
              </CardContent>
            </Card>
          )}

          {/* Admin: Disponierung */}
          {isAdmin && (
            <Card
              className="cursor-pointer hover:shadow-lg transition-all hover:border-primary/50"
              onClick={() => navigate("/resource-planning")}
            >
              <CardHeader className="space-y-2 pb-3">
                <div className="h-12 w-12 rounded-lg bg-accent/10 flex items-center justify-center">
                  <CalendarDays className="h-6 w-6 text-accent" />
                </div>
                <CardTitle className="text-lg sm:text-xl">Disponierung</CardTitle>
                <CardDescription className="text-sm">
                  Mitarbeiter, Fahrzeuge & Projekte einteilen
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full" size="sm" variant="outline">Disponieren</Button>
              </CardContent>
            </Card>
          )}

          {/* Admin: Mitarbeiter */}
          {isAdmin && (
            <Card
              className="cursor-pointer hover:shadow-lg transition-all hover:border-primary/50"
              onClick={() => navigate("/admin")}
            >
              <CardHeader className="space-y-2 pb-3">
                <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Users className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-lg sm:text-xl">Admin-Bereich</CardTitle>
                <CardDescription className="text-sm">
                  Benutzerverwaltung, Stunden & Verwaltung
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full" size="sm" variant="outline">Verwalten</Button>
              </CardContent>
            </Card>
          )}
        </div>

        {!isAdmin && (
          <Card className="mt-6 bg-primary/5 border-primary/20">
            <CardHeader>
              <CardTitle className="text-lg">Schnellhilfe</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>✓ <strong>Zeiterfassung:</strong> Täglich Stunden auf Projekte buchen</p>
              <p>✓ <strong>Projekte:</strong> Fotos, Regieberichte & Dokumente hochladen</p>
              <p>✓ <strong>Meine Stunden:</strong> Übersicht aller gebuchten Zeiten</p>
            </CardContent>
          </Card>
        )}

        {/* Projects Overview */}
        {projects.length > 0 && (
          <div className="mt-6 sm:mt-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl sm:text-2xl font-bold">Aktive Projekte</h2>
              <Button variant="ghost" size="sm" onClick={() => navigate("/projects")}>
                Alle anzeigen
                <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
            
            <div className="grid gap-3 sm:gap-4">
              {projects.map((project) => (
                <Card 
                  key={project.id} 
                  className="hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => navigate("/projects")}
                >
                  <CardContent className="p-3 sm:p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
                        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <FolderKanban className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm sm:text-base truncate">{project.name}</p>
                          <p className="text-xs text-muted-foreground">
                            Aktualisiert: {new Date(project.updated_at).toLocaleDateString("de-DE")}
                          </p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </main>

    </div>
  );
}
