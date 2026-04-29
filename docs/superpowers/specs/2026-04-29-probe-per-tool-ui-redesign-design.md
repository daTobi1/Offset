# Probe-per-Tool Konfiguration + UI-Redesign

**Datum:** 2026-04-29
**Status:** Approved
**Scope:** Frontend (JS/HTML) + Backend (offset.py)

## Zusammenfassung

Die Offset-UI wird um eine Probe-per-Toolhead Konfiguration für `CALIBRATE_PROBE_OFFSETS` erweitert. Gleichzeitig wird die rechte Spalte als Bootstrap Accordion reorganisiert (3 Sektionen: XY Offsets, Z-Switch Calibration, Probe Offset Calibration).

## Kontext

- **Drucker:** Voron 2.4 Stealthchanger (250mm: 4 Tools, 350mm: 6 Tools)
- **Probes:** `probe` (mechanischer Tap), `probe_eddy_ng my_eddy` (Eddy-NG)
- **Bestehend:** `CALIBRATE_PROBE_OFFSETS` in `offset.py` — hardcoded T0+Eddy als Referenz, alle Tools mit Tap
- **Ziel:** Pro Tool konfigurierbar welche Probe verwendet wird, inkl. Referenz-Tool/Probe

## Architektur

### Probe-Discovery

- Bei Verbindung zum Drucker: `/printer/objects/list` via Moonraker API abfragen
- Filtern nach Objektnamen die `probe` enthalten (z.B. `probe`, `probe_eddy_ng my_eddy`)
- Ausgeschlossen: `tool_probe_endstop` (virtueller Router, keine echte Probe)
- Ergebnis: Array von Probe-Namen, gecacht im Frontend

### Probe-Zuordnung (Frontend, localStorage)

- Pro Drucker-IP gespeichert unter Key `offset_probe_config_<ip>`
- Struktur:
  ```json
  {
    "ref_tool": 0,
    "ref_probe": "probe_eddy_ng my_eddy",
    "tool_probes": {
      "0": "probe_eddy_ng my_eddy",
      "1": "probe",
      "2": "probe",
      "3": "probe"
    }
  }
  ```
- Defaults: Erstes Tool mit Eddy-Probe = Referenz, Rest = `probe` (Tap)
- Wenn keine Eddy-Probe vorhanden: Erstes Tool mit `probe` als Referenz

### GCode-Generierung (Frontend → Klipper)

**Problem:** Probe-Namen wie `probe_eddy_ng my_eddy` enthalten Leerzeichen. Klippers GCode-Parser splittet auf Whitespace, daher funktioniert ein einzelner `PROBE_MAP`-Parameter nicht zuverlässig.

**Lösung:** Zweistufiger Ansatz — erst Probe-Map per `SET_PROBE_CAL_MAP` konfigurieren, dann `CALIBRATE_PROBE_OFFSETS` aufrufen.

Frontend sendet als GCode-Script (Zeilen mit `\n` getrennt):
```
SET_PROBE_CAL_MAP TOOL=0 PROBE="probe_eddy_ng my_eddy"
SET_PROBE_CAL_MAP TOOL=1 PROBE="probe"
SET_PROBE_CAL_MAP TOOL=2 PROBE="probe"
SET_PROBE_CAL_MAP TOOL=3 PROBE="probe"
CALIBRATE_PROBE_OFFSETS TOOLS=0,1,2,3 REF_TOOL=0
```

Hinweis: `SET_ACTIVE_Z_PROBE PROBE="probe_eddy_ng my_eddy"` funktioniert bereits auf dem Drucker — Klipper handhabt Quotes innerhalb von `run_script_from_command`. Dieselbe Konvention wird hier verwendet.

### Backend-Änderung (offset.py)

**Neuer GCode-Command: `SET_PROBE_CAL_MAP`**

Setzt die Probe-Zuordnung pro Tool in einem internen Dict `self.probe_cal_map`.

| Parameter | Typ | Default | Beschreibung |
|-----------|-----|---------|--------------|
| `TOOL` | int | (required) | Tool-Nummer |
| `PROBE` | string | (required) | Klipper Probe-Objektname |

Speicherung: `self.probe_cal_map[tool_nr] = probe_name`

**Erweiterte Parameter für `CALIBRATE_PROBE_OFFSETS`:**

| Parameter | Typ | Default | Beschreibung |
|-----------|-----|---------|--------------|
| `REF_TOOL` | int | 0 | Referenz-Tool für Bed-Reference |
| `TOOLS` | string | (alle) | Komma-separierte Tool-Nummern |
| `APPLY` | int | 1 | Offsets anwenden und Config stagen |

Die Probe pro Tool wird aus `self.probe_cal_map` gelesen. Fallback: Config-Default (Eddy für REF_TOOL, `probe` für Rest).

**Ablauf pro Tool (erweitert):**

1. `SELECT_TOOL T=<n>`
2. `SET_ACTIVE_TOOL_PROBE T=<n>`
3. Probe-Name aus `self.probe_cal_map[n]` lesen (Fallback: `probe`)
4. **Referenz-Tool:**
   - `SET_ACTIVE_Z_PROBE PROBE="<probe_name>"`
   - Wenn Eddy-Probe (Name enthält `eddy`): `PROBE_EDDY_NG_TAP HOME_Z=1 SAMPLES=<n>`
   - Wenn Tap-Probe: Standard-Probe via `run_single_probe`
5. **Andere Tools:**
   - Probe aus Map lesen
   - `SET_ACTIVE_Z_PROBE PROBE=none` falls Tap, oder `SET_ACTIVE_Z_PROBE PROBE="<name>"` falls andere Probe
   - Probing durchführen (Eddy oder Tap je nach Probe-Typ)
6. Offset berechnen (Formel unverändert)
7. Am Ende: Routing des Referenz-Tools wiederherstellen

**`get_status()` erweitert:**
```python
def get_status(self, eventtime):
    # ... bestehende Felder ...
    # Neu: verfügbare Probes für Frontend-Discovery
    available_probes = []
    for name in self.printer.lookup_objects('probe'):
        available_probes.append(name[0] if isinstance(name, tuple) else name)
    # Eddy-NG Probes
    for name in self.printer.lookup_objects('probe_eddy_ng'):
        full_name = name[0] if isinstance(name, tuple) else name
        available_probes.append(full_name)
    return {
        ...
        'available_probes': available_probes,
    }
```

## UI-Struktur: Accordion

### Gesamtlayout

```
┌─────────────────────┬──────────────────────────┐
│ Linke Spalte        │ Rechte Spalte            │
│ (unverändert)       │                          │
│                     │ [GCode Input + Send]     │
│ - Kamera + Overlay  │                          │
│ - Flip/Zoom/Kontrast│ ┌─ Accordion ──────────┐ │
│ - Position X/Y/Z    │ │ ▸ XY Offsets         │ │
│ - HOME/QGL/CAM/DIS  │ │   (Master + Tools)   │ │
│ - Cam Position      │ │                      │ │
│ - Bounce Buttons    │ │ ▸ Z-Switch Cal       │ │
│ - Big Move Buttons  │ │   (Tools/Ref/Calc)   │ │
│                     │ │                      │ │
│ [Klipper Console]   │ │ ▾ Probe Offset Cal   │ │
│                     │ │   Ref: [T0▾][Eddy▾]  │ │
│                     │ │   T0: [Eddy▾] REF    │ │
│                     │ │   T1: [Tap▾]         │ │
│                     │ │   T2: [Tap▾]         │ │
│                     │ │   T3: [Tap▾]         │ │
│                     │ │   [CALIBRATE]        │ │
│                     │ └──────────────────────┘ │
└─────────────────────┴──────────────────────────┘
```

### Accordion-Sektionen

**1. XY Offsets** (default: offen)
- Inhalt: bestehende Master-Row + Non-Master Tool Rows
- Header-Status (geschlossen): "Master: T0" oder "T0=Master, 3 Tools"
- Kompakteres Layout: weniger Padding

**2. Z-Switch Calibration** (default: geschlossen)
- Inhalt: bestehende calibrateButton()-Ausgabe (Tool-Checkboxen, Ref-Radio, Z-Calc Dropdown, Button)
- Header-Status: "Last: T0-T3 ✓" oder "Not run"
- Status aus `probe_results` ableitbar

**3. Probe Offset Calibration** (default: geschlossen)
- Referenz-Bereich: Tool-Dropdown + Probe-Dropdown
- Pro Tool: Checkbox + Probe-Dropdown
- Referenz-Tool bekommt grünes "REF" Badge
- "CALIBRATE PROBE OFFSETS" Button
- Header-Status: "Requires Z-Switch first" oder "Last run: T0-T3"
- Button disabled wenn keine `probe_results` vorhanden

### Bootstrap Accordion Konfiguration

- `data-bs-parent` wird NICHT gesetzt → `alwaysOpen` Verhalten (mehrere gleichzeitig offen)
- Jede Sektion hat eigene ID: `accordion-xy`, `accordion-zcal`, `accordion-probecal`
- Collapse-State wird NICHT in localStorage gespeichert (immer frisch bei Reload)

## Dateien-Änderungen

| Datei | Änderung |
|-------|----------|
| `index.html` | Rechte Spalte: `<ul id="tool-list">` → Bootstrap Accordion Container |
| `js/tools.js` | `getTools()`: Baut Accordion statt flache Liste. Neue Sektion `probeCalibrationSection()`. Probe-Discovery + localStorage. |
| `js/index.js` | `connectCamera()`: Ruft `fetchAvailableProbes()` nach Verbindung auf |
| `klippy/extras/offset.py` | Neuer Command `SET_PROBE_CAL_MAP`. `CALIBRATE_PROBE_OFFSETS`: `REF_TOOL` Parameter, liest Probe-Map aus internem State. `get_status()`: `available_probes` Feld |

## Nicht im Scope

- Linke Spalte wird nicht verändert
- Keine neuen JS-Dateien
- Kein Refactoring bestehender XY-Offset-Logik
- Kein `CALIBRATE_ALL_Z_OFFSETS` Umbau
- Keine Probe-Auto-Detection via Klipper Config (z_probe Einträge) — nur Objekt-Liste
