

# Abwesenheit mit Von/Bis-Zeiten ermoeglichen

## Aktuelles Verhalten
Die Abwesenheit wird derzeit immer als ganzer Tag erfasst (automatisch berechnete Stunden basierend auf Kernarbeitszeit). Man kann zwar die Stundenzahl manuell anpassen, aber es gibt keine Moeglichkeit, konkrete Start- und Endzeiten einzugeben.

## Geplante Aenderung

Im Abwesenheits-Dialog werden **Start- und Endzeit-Felder** hinzugefuegt, sodass man z.B. nur einen halben Tag Urlaub oder nur den Nachmittag als ZA buchen kann.

### Neues UI im Abwesenheits-Dialog

- **"Ganzer Tag"** bleibt als Standard (Checkbox oder Toggle)
- Wenn "Ganzer Tag" deaktiviert wird, erscheinen:
  - **Von** (time input) - z.B. 12:00
  - **Bis** (time input) - z.B. 16:00
  - **Pause** (Minuten, optional)
- Die Stunden werden dann automatisch aus Von/Bis berechnet
- Die bisherige manuelle Stundenanpassung bleibt als Alternative

### Speicher-Logik

Beim Speichern werden die eingegebenen Start/Ende-Zeiten direkt in `time_entries.start_time` und `time_entries.end_time` geschrieben (statt der bisherigen Standard-Kernarbeitszeiten). Die berechneten Stunden ergeben sich aus der Differenz minus Pause.

### Beispiel-Szenarien
- **Halber Tag Urlaub am Nachmittag**: Von 12:00 bis 16:00 = 4 Stunden Urlaub
- **ZA nur am Vormittag**: Von 07:00 bis 12:00 = 5 Stunden ZA-Abzug
- **Ganzer Tag Krankenstand**: Wie bisher automatisch (Mo-Do: 8,5h, Fr: 4,5h)

## Technische Details

### Datei: `src/pages/TimeTracking.tsx`

**State erweitern:**
```text
absenceData wird um folgende Felder ergaenzt:
- isFullDay: boolean (Standard: true)
- startTime: string (z.B. "12:00")
- endTime: string (z.B. "16:00")
- pauseMinutes: string (z.B. "0" oder "30")
```

**UI-Aenderung im Abwesenheits-Dialog (Zeilen 993-1101):**
- Nach dem Datum-Feld: Checkbox/Switch "Ganzer Tag" (Standard: an)
- Wenn aus: zwei Time-Inputs fuer Von/Bis und ein Pausen-Feld
- Die Stundenberechnung passt sich dynamisch an: Bei Teilzeit wird aus Von/Bis minus Pause berechnet
- Das bestehende "Stunden anpassen"-Feld wird nur bei "Ganzer Tag" angezeigt

**Speicher-Logik (Zeilen 374-440):**
- Wenn `isFullDay` aus: Stunden aus startTime/endTime/pauseMinutes berechnen
- `start_time` und `end_time` aus den Eingabefeldern uebernehmen statt aus `getDefaultWorkTimes()`

### Keine Datenbank-Aenderungen noetig
Die bestehende `time_entries`-Tabelle hat bereits `start_time`, `end_time` und `pause_minutes` Spalten.

