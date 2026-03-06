import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, Loader2, Palmtree } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { de } from "date-fns/locale";

type Profile = {
  id: string;
  vorname: string;
  nachname: string;
};

type LeaveBalance = {
  id: string;
  user_id: string;
  year: number;
  total_days: number;
  used_days: number;
};

interface LeaveManagementProps {
  profiles: Profile[];
}

export default function LeaveManagement({ profiles }: LeaveManagementProps) {
  const { toast } = useToast();
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [vacationDates, setVacationDates] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [editingBalance, setEditingBalance] = useState<string | null>(null);
  const [editDays, setEditDays] = useState("");

  const fetchData = async () => {
    setLoading(true);

    // Fetch leave balances
    const { data: balData } = await supabase
      .from("leave_balances")
      .select("*")
      .eq("year", selectedYear);

    if (balData) setBalances(balData as LeaveBalance[]);

    // Fetch vacation time entries for all users in selected year
    const yearStart = `${selectedYear}-01-01`;
    const yearEnd = `${selectedYear}-12-31`;
    const { data: vacEntries } = await supabase
      .from("time_entries")
      .select("user_id, datum")
      .eq("taetigkeit", "Urlaub")
      .gte("datum", yearStart)
      .lte("datum", yearEnd)
      .order("datum", { ascending: true });

    // Group by user_id with unique dates
    const grouped: Record<string, string[]> = {};
    if (vacEntries) {
      vacEntries.forEach((e) => {
        if (!grouped[e.user_id]) grouped[e.user_id] = [];
        if (!grouped[e.user_id].includes(e.datum)) {
          grouped[e.user_id].push(e.datum);
        }
      });
    }
    setVacationDates(grouped);

    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [selectedYear]);

  const ensureBalance = async (userId: string) => {
    const existing = balances.find((b) => b.user_id === userId && b.year === selectedYear);
    if (existing) return;

    await supabase.from("leave_balances").insert({
      user_id: userId,
      year: selectedYear,
      total_days: 25,
      used_days: 0,
    });
    fetchData();
  };

  const updateTotalDays = async (balanceId: string, totalDays: number) => {
    const { error } = await supabase
      .from("leave_balances")
      .update({ total_days: totalDays })
      .eq("id", balanceId);

    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
    } else {
      toast({ title: "Gespeichert", description: "Urlaubstage aktualisiert" });
    }
    setEditingBalance(null);
    fetchData();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Palmtree className="h-5 w-5" />
                Urlaubskontingent {selectedYear}
              </CardTitle>
              <CardDescription>Urlaubstage pro Mitarbeiter verwalten (verbrauchte Tage werden aus Zeiteinträgen mit Tätigkeit "Urlaub" berechnet)</CardDescription>
            </div>
            <Select
              value={String(selectedYear)}
              onValueChange={(v) => setSelectedYear(Number(v))}
            >
              <SelectTrigger className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[selectedYear - 1, selectedYear, selectedYear + 1].map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {profiles
              .filter((p) => p.vorname && p.nachname)
              .map((profile) => {
                const balance = balances.find(
                  (b) => b.user_id === profile.id && b.year === selectedYear
                );
                const dates = vacationDates[profile.id] || [];
                const usedDays = dates.length;
                const totalDays = balance?.total_days ?? 25;
                const remaining = totalDays - usedDays;

                return (
                  <div
                    key={profile.id}
                    className="p-4 rounded-lg border space-y-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">
                          {profile.vorname} {profile.nachname}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {balance
                            ? `${usedDays} von ${totalDays} Tagen verbraucht`
                            : "Noch kein Kontingent angelegt"}
                          {balance && (
                            <span className={remaining < 0 ? "text-red-600 font-medium" : "text-green-600 font-medium"}>
                              {" "}· {remaining} übrig
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {balance && editingBalance === balance.id ? (
                          <div className="flex gap-1">
                            <Input
                              type="number"
                              value={editDays}
                              onChange={(e) => setEditDays(e.target.value)}
                              className="w-20"
                            />
                            <Button
                              size="sm"
                              onClick={() =>
                                updateTotalDays(balance.id, Number(editDays))
                              }
                            >
                              OK
                            </Button>
                          </div>
                        ) : balance ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setEditingBalance(balance.id);
                              setEditDays(String(balance.total_days));
                            }}
                          >
                            Tage ändern
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => ensureBalance(profile.id)}
                          >
                            Kontingent anlegen
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Vacation dates as badges */}
                    {dates.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {dates.map((date) => (
                          <Badge key={date} variant="secondary" className="text-xs">
                            <Calendar className="h-3 w-3 mr-1" />
                            {format(new Date(date), "dd.MM.", { locale: de })}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
