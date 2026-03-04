import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Clock, Plus, History, Loader2, CalendarCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO, isSameDay } from "date-fns";
import { de } from "date-fns/locale";
import { getNormalWorkingHours, getWorkModelLabel } from "@/lib/workingHours";

type Profile = {
  id: string;
  vorname: string;
  nachname: string;
};

type TimeAccount = {
  id: string;
  user_id: string;
  balance_hours: number;
};

type Transaction = {
  id: string;
  user_id: string;
  changed_by: string;
  change_type: string;
  hours: number;
  balance_before: number;
  balance_after: number;
  reason: string | null;
  created_at: string;
};

interface TimeAccountManagementProps {
  profiles: Profile[];
}

const monthNames = [
  "Jänner", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember"
];

export default function TimeAccountManagement({ profiles }: TimeAccountManagementProps) {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<TimeAccount[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdjustDialog, setShowAdjustDialog] = useState(false);
  const [showHistoryDialog, setShowHistoryDialog] = useState(false);
  const [showCloseMonthDialog, setShowCloseMonthDialog] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [adjustHours, setAdjustHours] = useState("");
  const [adjustType, setAdjustType] = useState<"gutschrift" | "abzug">("gutschrift");
  const [adjustReason, setAdjustReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Monatsabschluss state
  const now = new Date();
  const defaultCloseMonth = now.getMonth() === 0 ? 12 : now.getMonth(); // Vormonat
  const defaultCloseYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const [closeMonth, setCloseMonth] = useState(defaultCloseMonth);
  const [closeYear, setCloseYear] = useState(defaultCloseYear);
  const [closeData, setCloseData] = useState<{
    userId: string;
    name: string;
    model: string;
    wochenstunden: number;
    istHours: number;
    sollHours: number;
    diff: number;
    currentBalance: number;
    alreadyClosed: boolean;
  }[]>([]);
  const [closeLoading, setCloseLoading] = useState(false);
  const [closeSubmitting, setCloseSubmitting] = useState(false);

  const years = Array.from({ length: 3 }, (_, i) => new Date().getFullYear() - 1 + i);

  const fetchData = async () => {
    setLoading(true);
    const [{ data: accData }, { data: txData }] = await Promise.all([
      supabase.from("time_accounts").select("*"),
      supabase
        .from("time_account_transactions")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    if (accData) setAccounts(accData as TimeAccount[]);
    if (txData) setTransactions(txData as Transaction[]);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const getProfileName = (userId: string) => {
    const p = profiles.find((p) => p.id === userId);
    return p ? `${p.vorname} ${p.nachname}` : "Unbekannt";
  };

  const ensureAccount = async (userId: string) => {
    const { error } = await supabase.from("time_accounts").insert({
      user_id: userId,
      balance_hours: 0,
    });
    if (error) {
      toast({ variant: "destructive", title: "Fehler", description: error.message });
    }
    fetchData();
  };

  const handleAdjust = async () => {
    if (!selectedUserId || !adjustHours || !adjustReason.trim()) {
      toast({ variant: "destructive", title: "Fehler", description: "Bitte alle Felder ausfüllen" });
      return;
    }

    setSubmitting(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSubmitting(false); return; }

    const account = accounts.find((a) => a.user_id === selectedUserId);
    if (!account) {
      toast({ variant: "destructive", title: "Fehler", description: "Kein Zeitkonto gefunden" });
      setSubmitting(false);
      return;
    }

    const hours = parseFloat(adjustHours);
    const effectiveHours = adjustType === "abzug" ? -hours : hours;
    const balanceBefore = account.balance_hours;
    const balanceAfter = balanceBefore + effectiveHours;

    const { error: updateErr } = await supabase
      .from("time_accounts")
      .update({ balance_hours: balanceAfter })
      .eq("id", account.id);

    if (updateErr) {
      toast({ variant: "destructive", title: "Fehler", description: updateErr.message });
      setSubmitting(false);
      return;
    }

    await supabase.from("time_account_transactions").insert({
      user_id: selectedUserId,
      changed_by: user.id,
      change_type: adjustType === "gutschrift" ? "Gutschrift" : "Abzug",
      hours: effectiveHours,
      balance_before: balanceBefore,
      balance_after: balanceAfter,
      reason: adjustReason.trim(),
    });

    toast({
      title: "Zeitkonto aktualisiert",
      description: `${getProfileName(selectedUserId)}: ${effectiveHours > 0 ? "+" : ""}${effectiveHours.toFixed(2)} h`,
    });

    setShowAdjustDialog(false);
    setAdjustHours("");
    setAdjustReason("");
    setSubmitting(false);
    fetchData();
  };

  // ============================
  // Monatsabschluss berechnen
  // ============================
  const calculateCloseData = async () => {
    setCloseLoading(true);
    const startDate = new Date(closeYear, closeMonth - 1, 1);
    const endDate = new Date(closeYear, closeMonth, 0);
    const startStr = format(startDate, "yyyy-MM-dd");
    const endStr = format(endDate, "yyyy-MM-dd");
    const monthLabel = `${monthNames[closeMonth - 1]} ${closeYear}`;

    // Fetch all time entries for the month
    const { data: allEntries } = await supabase
      .from("time_entries")
      .select("user_id, datum, stunden")
      .gte("datum", startStr)
      .lte("datum", endStr);

    // Fetch employee wochenstunden
    const { data: employees } = await supabase
      .from("employees")
      .select("user_id, wochenstunden");

    // Check existing monthly close transactions
    const { data: existingTx } = await supabase
      .from("time_account_transactions")
      .select("user_id, reason")
      .eq("change_type", "Monatsabschluss")
      .ilike("reason", `%${monthLabel}%`);

    const closedUserIds = new Set((existingTx || []).map(t => t.user_id));
    const employeeMap = new Map((employees || []).map(e => [e.user_id, e.wochenstunden || 40]));

    const result: typeof closeData = [];

    for (const profile of profiles) {
      const account = accounts.find(a => a.user_id === profile.id);
      if (!account) continue; // Nur Mitarbeiter mit Zeitkonto

      const wochenstunden = employeeMap.get(profile.id) || 40;
      const userEntries = (allEntries || []).filter(e => e.user_id === profile.id);
      const istHours = userEntries.reduce((sum, e) => sum + (e.stunden || 0), 0);

      // Soll-Stunden berechnen: für jeden Arbeitstag im Monat
      let sollHours = 0;
      const daysInMonth = endDate.getDate();
      for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(closeYear, closeMonth - 1, d);
        const dayOfWeek = date.getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) continue; // Wochenende

        let tagesSoll = getNormalWorkingHours(date, wochenstunden);
        // Für flexible Modelle (20h/10h) gibt getNormalWorkingHours 0 zurück
        // Hier verwenden wir wochenstunden / 5 als Tages-Soll
        if ((wochenstunden === 20 || wochenstunden === 10) && tagesSoll === 0) {
          tagesSoll = wochenstunden / 5;
        }
        sollHours += tagesSoll;
      }

      const diff = istHours - sollHours;

      result.push({
        userId: profile.id,
        name: `${profile.vorname} ${profile.nachname}`,
        model: getWorkModelLabel(wochenstunden),
        wochenstunden,
        istHours,
        sollHours,
        diff,
        currentBalance: Number(account.balance_hours),
        alreadyClosed: closedUserIds.has(profile.id),
      });
    }

    setCloseData(result);
    setCloseLoading(false);
  };

  useEffect(() => {
    if (showCloseMonthDialog) {
      calculateCloseData();
    }
  }, [showCloseMonthDialog, closeMonth, closeYear]);

  const handleCloseMonth = async () => {
    setCloseSubmitting(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setCloseSubmitting(false); return; }

    const monthLabel = `${monthNames[closeMonth - 1]} ${closeYear}`;
    let successCount = 0;

    for (const item of closeData) {
      if (item.alreadyClosed) continue;

      const account = accounts.find(a => a.user_id === item.userId);
      if (!account) continue;

      const currentBalance = Number(account.balance_hours);

      // Transaktion 1: Monatsabschluss (Differenz buchen)
      const balanceAfterDiff = currentBalance + item.diff;
      await supabase.from("time_account_transactions").insert({
        user_id: item.userId,
        changed_by: user.id,
        change_type: "Monatsabschluss",
        hours: item.diff,
        balance_before: currentBalance,
        balance_after: balanceAfterDiff,
        reason: `Monatsabschluss ${monthLabel}: ${item.istHours.toFixed(1)}h Ist, ${item.sollHours.toFixed(1)}h Soll, Differenz ${item.diff >= 0 ? "+" : ""}${item.diff.toFixed(2)}h`,
      });

      // Transaktion 2: Auszahlung (auf 0 setzen)
      await supabase.from("time_account_transactions").insert({
        user_id: item.userId,
        changed_by: user.id,
        change_type: "Auszahlung",
        hours: -balanceAfterDiff,
        balance_before: balanceAfterDiff,
        balance_after: 0,
        reason: `Barauszahlung ${monthLabel}`,
      });

      // Konto auf 0 setzen
      await supabase
        .from("time_accounts")
        .update({ balance_hours: 0 })
        .eq("id", account.id);

      successCount++;
    }

    toast({
      title: "Monat abgeschlossen",
      description: `${successCount} Zeitkonto(en) für ${monthLabel} abgeschlossen und auf 0 gesetzt.`,
    });

    setCloseSubmitting(false);
    setShowCloseMonthDialog(false);
    fetchData();
  };

  const userTransactions = selectedUserId
    ? transactions.filter((t) => t.user_id === selectedUserId)
    : [];

  const hasUnclosedAccounts = closeData.some(d => !d.alreadyClosed);

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
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Zeitkonten
              </CardTitle>
              <CardDescription>ZDA-Konten pro Mitarbeiter</CardDescription>
            </div>
            <Button variant="outline" onClick={() => setShowCloseMonthDialog(true)}>
              <CalendarCheck className="h-4 w-4 mr-2" />
              Monat abschließen
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {profiles
              .filter((p) => p.vorname && p.nachname)
              .map((profile) => {
                const account = accounts.find((a) => a.user_id === profile.id);
                return (
                  <div key={profile.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-lg border">
                    <div>
                      <p className="font-medium">{profile.vorname} {profile.nachname}</p>
                      {account ? (
                        <p className="text-sm">
                          Saldo:{" "}
                          <span className={account.balance_hours >= 0 ? "text-green-600 font-semibold" : "text-destructive font-semibold"}>
                            {account.balance_hours >= 0 ? "+" : ""}{Number(account.balance_hours).toFixed(2)} h
                          </span>
                        </p>
                      ) : (
                        <p className="text-sm text-muted-foreground">Noch kein Zeitkonto</p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {account ? (
                        <>
                          <Button variant="outline" size="sm" onClick={() => { setSelectedUserId(profile.id); setShowAdjustDialog(true); }}>
                            <Plus className="h-3 w-3 mr-1" /> Buchen
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => { setSelectedUserId(profile.id); setShowHistoryDialog(true); }}>
                            <History className="h-3 w-3 mr-1" /> Verlauf
                          </Button>
                        </>
                      ) : (
                        <Button variant="outline" size="sm" onClick={() => ensureAccount(profile.id)}>Zeitkonto anlegen</Button>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </CardContent>
      </Card>

      {/* Adjust Dialog */}
      <Dialog open={showAdjustDialog} onOpenChange={setShowAdjustDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Zeitkonto buchen</DialogTitle>
            <DialogDescription>{selectedUserId && getProfileName(selectedUserId)}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Art</Label>
              <Select value={adjustType} onValueChange={(v) => setAdjustType(v as "gutschrift" | "abzug")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="gutschrift">Gutschrift (ZDA)</SelectItem>
                  <SelectItem value="abzug">Abzug (Zeitausgleich / ZA)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Stunden</Label>
              <Input type="number" step="0.5" min="0.5" value={adjustHours} onChange={(e) => setAdjustHours(e.target.value)} placeholder="z.B. 8" />
            </div>
            <div className="space-y-2">
              <Label>Grund (Pflichtfeld)</Label>
              <Textarea value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} placeholder="z.B. ZDA KW12, ZA-Tag 15.03...." rows={2} />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowAdjustDialog(false)}>Abbrechen</Button>
              <Button onClick={handleAdjust} disabled={submitting}>{submitting ? "Wird gebucht..." : "Buchen"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* History Dialog */}
      <Dialog open={showHistoryDialog} onOpenChange={setShowHistoryDialog}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Verlauf – {selectedUserId && getProfileName(selectedUserId)}</DialogTitle>
            <DialogDescription>Alle Buchungen und Änderungen am Zeitkonto</DialogDescription>
          </DialogHeader>
          {userTransactions.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">Noch keine Buchungen</p>
          ) : (
            <div className="space-y-2">
              {userTransactions.map((tx) => (
                <div key={tx.id} className="p-3 rounded-lg border text-sm space-y-1">
                  <div className="flex items-center justify-between">
                    <Badge variant={tx.hours >= 0 ? "default" : "destructive"}>
                      {tx.hours >= 0 ? "+" : ""}{Number(tx.hours).toFixed(2)} h · {tx.change_type}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(tx.created_at), "dd.MM.yyyy HH:mm", { locale: de })}
                    </span>
                  </div>
                  <p className="text-muted-foreground">{tx.reason || "Kein Grund angegeben"}</p>
                  <p className="text-xs text-muted-foreground">
                    Saldo: {Number(tx.balance_before).toFixed(2)} → {Number(tx.balance_after).toFixed(2)} h · geändert von {getProfileName(tx.changed_by)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Monatsabschluss Dialog */}
      <Dialog open={showCloseMonthDialog} onOpenChange={setShowCloseMonthDialog}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarCheck className="h-5 w-5" />
              Monat abschließen
            </DialogTitle>
            <DialogDescription>
              ZDA-Stunden berechnen, buchen und Konten auf 0 setzen
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-3 mb-4">
            <Select value={closeMonth.toString()} onValueChange={(v) => setCloseMonth(parseInt(v))}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {monthNames.map((name, i) => (
                  <SelectItem key={i} value={(i + 1).toString()}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={closeYear.toString()} onValueChange={(v) => setCloseYear(parseInt(v))}>
              <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {years.map((y) => (<SelectItem key={y} value={y.toString()}>{y}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>

          {closeLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : closeData.length === 0 ? (
            <p className="text-center text-muted-foreground py-4">Keine Mitarbeiter mit Zeitkonto gefunden.</p>
          ) : (
            <>
              <ScrollArea className="max-h-[400px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mitarbeiter</TableHead>
                      <TableHead>Modell</TableHead>
                      <TableHead className="text-right">Ist</TableHead>
                      <TableHead className="text-right">Soll</TableHead>
                      <TableHead className="text-right">+/-</TableHead>
                      <TableHead className="text-right">Aktuell</TableHead>
                      <TableHead className="text-right">→ Neu</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {closeData.map((item) => (
                      <TableRow key={item.userId} className={item.alreadyClosed ? "opacity-50" : ""}>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell className="text-xs">{item.model}</TableCell>
                        <TableCell className="text-right">{item.istHours.toFixed(1)}</TableCell>
                        <TableCell className="text-right">{item.sollHours.toFixed(1)}</TableCell>
                        <TableCell className={`text-right font-semibold ${item.diff >= 0 ? "text-green-600" : "text-destructive"}`}>
                          {item.diff >= 0 ? "+" : ""}{item.diff.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right">{item.currentBalance.toFixed(2)}</TableCell>
                        <TableCell className="text-right font-semibold">0.00</TableCell>
                        <TableCell>
                          {item.alreadyClosed ? (
                            <Badge variant="secondary" className="text-[10px]">Bereits abgeschlossen</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px]">Offen</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>

              <div className="flex justify-end gap-2 mt-4">
                <Button variant="outline" onClick={() => setShowCloseMonthDialog(false)}>Abbrechen</Button>
                <Button
                  onClick={handleCloseMonth}
                  disabled={closeSubmitting || !hasUnclosedAccounts}
                >
                  {closeSubmitting ? "Wird abgeschlossen..." : `${monthNames[closeMonth - 1]} ${closeYear} abschließen`}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
