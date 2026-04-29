# Probe-per-Tool + Accordion UI Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-tool probe selection for `CALIBRATE_PROBE_OFFSETS` and reorganize the right column as a Bootstrap accordion with 3 sections.

**Architecture:** Backend (`offset.py`) gets a new `SET_PROBE_CAL_MAP` command and `REF_TOOL` parameter. Frontend reorganizes the tool list into an accordion (XY Offsets, Z-Switch Cal, Probe Offset Cal) with probe dropdowns auto-populated from Klipper's object list. Probe config is persisted in localStorage per printer IP.

**Tech Stack:** Python (Klipper module), JavaScript (jQuery + Bootstrap 5.3), HTML, Moonraker API

---

### Task 1: Backend — `SET_PROBE_CAL_MAP` command + `get_status()` extension

**Files:**
- Modify: `klippy/extras/offset.py`

**Context:** The current `offset.py` is on the printer at `/home/biqu/klipper/klippy/extras/offset.py`. Read it from there via SSH (`ssh biqu@192.168.178.60`). The local copy at `D:\Claude Code\Offset\klippy\extras\offset.py` is the Git repo version — edit this one, then deploy to printer.

- [ ] **Step 1: Add `self.probe_cal_map` dict and register `SET_PROBE_CAL_MAP` command**

In `__init__`, after `self.probe_results = {}`, add:

```python
self.probe_cal_map = {}
```

After the `self.gcode.register_command('CALIBRATE_PROBE_OFFSETS', ...)` line, add:

```python
self.gcode.register_command('SET_PROBE_CAL_MAP',
                            self.cmd_SET_PROBE_CAL_MAP,
                            desc="Set probe assignment for a tool (used by CALIBRATE_PROBE_OFFSETS)")
```

- [ ] **Step 2: Implement `cmd_SET_PROBE_CAL_MAP`**

Add this method to the `Offset` class, after the `cmd_CALIBRATE_PROBE_OFFSETS` method:

```python
def cmd_SET_PROBE_CAL_MAP(self, gcmd):
    tool = gcmd.get_int('TOOL', None)
    if tool is None:
        raise gcmd.error("SET_PROBE_CAL_MAP requires TOOL parameter")
    # get_commandline() returns the raw line; parse PROBE= manually
    # to handle quoted probe names with spaces
    raw = gcmd.get_commandline()
    probe_match = None
    # Try quoted: PROBE="some name"
    import re
    m = re.search(r'PROBE="([^"]+)"', raw, re.IGNORECASE)
    if m:
        probe_match = m.group(1)
    else:
        # Try unquoted: PROBE=probe
        m = re.search(r'PROBE=(\S+)', raw, re.IGNORECASE)
        if m:
            probe_match = m.group(1)
    if not probe_match:
        raise gcmd.error("SET_PROBE_CAL_MAP requires PROBE parameter")
    self.probe_cal_map[tool] = probe_match
    self.gcode.respond_info(
        "Probe cal map: T%d -> %s" % (tool, probe_match))
```

- [ ] **Step 3: Extend `get_status()` with `available_probes` and `probe_cal_map`**

Replace the existing `get_status()` method with:

```python
def get_status(self, eventtime):
    tp_offsets = {}
    for tn in self.toolchanger.tool_numbers:
        try:
            tp = self.printer.lookup_object('tool_probe T%d' % tn)
            tp_offsets[str(tn)] = tp.probe_offsets.z_offset
        except Exception:
            pass
    # Discover available probe objects
    available_probes = []
    for obj_name, obj in self.printer.lookup_objects('probe'):
        if obj_name and 'tool_probe_endstop' not in obj_name:
            available_probes.append(obj_name)
    for obj_name, obj in self.printer.lookup_objects('probe_eddy_ng'):
        if obj_name:
            available_probes.append(obj_name)
    # Current probe_cal_map as string keys for JSON
    pcm = {}
    for k, v in self.probe_cal_map.items():
        pcm[str(k)] = v
    return {
        'probe_results': self.probe_results,
        'tool_probe_offsets': tp_offsets,
        'has_cfg_data': self.has_cfg_data,
        'has_switch_pos': self.has_switch_pos(),
        'z_calc_method': self.z_calc_method,
        'z_trim_count': self.z_trim_count,
        'ref_tool': self.last_ref_tool,
        'available_probes': available_probes,
        'probe_cal_map': pcm,
    }
```

- [ ] **Step 4: Commit**

```bash
cd "D:\Claude Code\Offset"
git add klippy/extras/offset.py
git commit -m "feat: add SET_PROBE_CAL_MAP command and available_probes in get_status"
```

---

### Task 2: Backend — Extend `CALIBRATE_PROBE_OFFSETS` to use probe map

**Files:**
- Modify: `klippy/extras/offset.py`

**Context:** The current `cmd_CALIBRATE_PROBE_OFFSETS` method hardcodes T0+Eddy as reference and Tap for all tools. We need to read from `self.probe_cal_map` and support `REF_TOOL` parameter. The existing method is ~100 lines. Key sections to change: reference tool selection, probe activation per tool, and the restore step at the end.

- [ ] **Step 1: Read current method from printer for latest version**

```bash
ssh biqu@192.168.178.60 "python3 -c \"
import inspect, importlib.util
spec = importlib.util.spec_from_file_location('offset', '/home/biqu/klipper/klippy/extras/offset.py')
mod = importlib.util.module_from_spec(spec)
# just print the raw file section
\" 2>/dev/null" || true
```

Use the version already read in brainstorming (the full `cmd_CALIBRATE_PROBE_OFFSETS` from the SSH read).

- [ ] **Step 2: Add `_is_eddy_probe` helper and `_get_probe_for_tool` helper**

Add these methods before `cmd_CALIBRATE_PROBE_OFFSETS`:

```python
def _is_eddy_probe(self, probe_name):
    """Check if a probe name refers to an Eddy-NG probe."""
    return 'eddy' in probe_name.lower()

def _get_probe_for_tool(self, tool_nr, ref_tool):
    """Get probe name for a tool from probe_cal_map with fallback."""
    if tool_nr in self.probe_cal_map:
        return self.probe_cal_map[tool_nr]
    # Fallback: ref_tool gets first eddy probe if available, others get 'probe'
    if tool_nr == ref_tool:
        # Check available probes for an eddy
        for obj_name, obj in self.printer.lookup_objects('probe_eddy_ng'):
            if obj_name:
                return obj_name
    return 'probe'
```

- [ ] **Step 3: Rewrite `cmd_CALIBRATE_PROBE_OFFSETS` to use probe map**

Replace the entire `cmd_CALIBRATE_PROBE_OFFSETS` method with the version below. Key changes marked with `# CHANGED`:

```python
def cmd_CALIBRATE_PROBE_OFFSETS(self, gcmd):
    if not self.is_homed():
        raise gcmd.error("Must home first")

    if not self.probe_results:
        raise gcmd.error(
            "No Z-switch data. Run CALIBRATE_ALL_Z_OFFSETS first")

    apply_offsets = gcmd.get_int('APPLY', 1)
    samples = gcmd.get_int('SAMPLES', self.probe_offset_samples, minval=1)
    probe_x = gcmd.get_float('PROBE_X', self.probe_offset_x)
    probe_y = gcmd.get_float('PROBE_Y', self.probe_offset_y)
    z_hop = gcmd.get_float('Z_HOP', self.probe_offset_z_hop, above=0.)
    travel_speed = gcmd.get_float('TRAVEL_SPEED',
                                   self.probe_offset_travel_speed, above=0.)

    # CHANGED: REF_TOOL parameter (was hardcoded to 0)
    ref_tool = gcmd.get_int('REF_TOOL', self.default_ref_tool, minval=0)

    # Parse TOOLS parameter
    tools_param = gcmd.get('TOOLS', None)
    available_tools = sorted(self.toolchanger.tool_numbers)

    if tools_param is not None:
        try:
            requested = [int(t.strip())
                         for t in tools_param.split(',') if t.strip()]
        except ValueError:
            raise gcmd.error(
                "TOOLS must be comma-separated integers, e.g. TOOLS=0,1,2")
        for t in requested:
            if t not in available_tools:
                raise gcmd.error(f"Tool T{t} not configured")
        calibrate_tools = requested
    else:
        calibrate_tools = [t for t in available_tools
                           if str(t) in self.probe_results]

    if not calibrate_tools:
        raise gcmd.error("No tools to calibrate")

    # Ensure ref_tool is valid
    if ref_tool not in available_tools:
        ref_tool = available_tools[0]

    # Verify all requested tools have z_offset data
    missing = [t for t in calibrate_tools
               if str(t) not in self.probe_results]
    if missing:
        raise gcmd.error(
            "Missing Z-switch data for T%s. "
            "Run CALIBRATE_ALL_Z_OFFSETS first"
            % ",".join(str(t) for t in missing))

    toolhead = self.printer.lookup_object('toolhead')
    probe_obj = self.printer.lookup_object('probe')

    # CHANGED: Get ref probe from map
    ref_probe_name = self._get_probe_for_tool(ref_tool, ref_tool)
    ref_is_eddy = self._is_eddy_probe(ref_probe_name)

    # ── Step 1: Reference probe on ref_tool → Z=0 at true nozzle contact ──
    self.gcode.respond_info("=== Probe Offset Calibration ===")
    self.gcode.respond_info(
        "Tools: %s  Ref: T%d (%s)"
        % (", ".join("T%d" % t for t in calibrate_tools),
           ref_tool, ref_probe_name))

    # CHANGED: Use ref_tool instead of hardcoded T0
    self.gcode.respond_info(
        "Step 1: %s on T%d (bed reference)"
        % ("Eddy Tap" if ref_is_eddy else "Tap", ref_tool))

    self.gcode.run_script_from_command(
        "SELECT_TOOL T=%d RESTORE_AXIS=XYZ" % ref_tool)
    self.gcode.run_script_from_command("STOP_TOOL_PROBE_CRASH_DETECTION")
    self.gcode.run_script_from_command(
        "SET_ACTIVE_TOOL_PROBE T=%d" % ref_tool)

    # Position nozzle at probe point
    self.gcode_move.cmd_G1(
        self.gcode.create_gcode_command(
            "G0", "G0",
            {'X': probe_x, 'Y': probe_y, 'F': travel_speed * 60}
        )
    )
    toolhead.wait_moves()

    # CHANGED: Use ref probe (Eddy or Tap) based on map
    if ref_is_eddy:
        self.gcode.run_script_from_command(
            'SET_ACTIVE_Z_PROBE PROBE="%s"' % ref_probe_name)
        self.gcode.run_script_from_command(
            "PROBE_EDDY_NG_TAP HOME_Z=1 SAMPLES=%d" % samples)
        self.gcode.respond_info(
            "T%d Eddy Tap: Z=0 set at nozzle contact" % ref_tool)
    else:
        self.gcode.run_script_from_command(
            "SET_ACTIVE_Z_PROBE PROBE=none")
        # Tap reference: probe and set Z=0 at contact
        toolhead.manual_move([None, None, 5.0], 10.)
        toolhead.wait_moves()
        bed_z = self._do_tap_probe(probe_obj, samples)
        # Set current Z as reference
        self.gcode.respond_info(
            "T%d Tap: bed_z=%.4f (reference)" % (ref_tool, bed_z))

    toolhead.manual_move([None, None, z_hop], 10.)
    toolhead.wait_moves()

    # ── Step 2: Probe on each selected tool ──
    self.gcode.respond_info("Step 2: Probe per tool")

    for tool_nr in calibrate_tools:
        key = str(tool_nr)
        gcode_z_off = self.probe_results[key]['z_offset']

        # CHANGED: Get probe for this tool from map
        tool_probe_name = self._get_probe_for_tool(tool_nr, ref_tool)
        tool_is_eddy = self._is_eddy_probe(tool_probe_name)

        self.gcode.respond_info(
            "--- T%d (gcode_z_offset=%.4f, probe=%s) ---"
            % (tool_nr, gcode_z_off, tool_probe_name))

        if tool_nr != ref_tool or self.toolchanger.active_tool.tool_number != ref_tool:
            self.gcode.run_script_from_command(
                "SELECT_TOOL T=%d RESTORE_AXIS=Z" % tool_nr)
        self.gcode.run_script_from_command("STOP_TOOL_PROBE_CRASH_DETECTION")
        self.gcode.run_script_from_command(
            "SET_ACTIVE_TOOL_PROBE T=%d" % tool_nr)

        # CHANGED: Activate probe from map
        if tool_is_eddy:
            self.gcode.run_script_from_command(
                'SET_ACTIVE_Z_PROBE PROBE="%s"' % tool_probe_name)
        else:
            self.gcode.run_script_from_command(
                "SET_ACTIVE_Z_PROBE PROBE=none")

        # Position nozzle at probe point
        self.gcode_move.cmd_G1(
            self.gcode.create_gcode_command(
                "G0", "G0",
                {'X': probe_x, 'Y': probe_y, 'F': travel_speed * 60}
            )
        )
        toolhead.manual_move([None, None, 5.0], 10.)
        toolhead.wait_moves()

        current_pz = probe_obj.get_offsets()[2]

        # CHANGED: Probe with appropriate method
        if tool_is_eddy:
            # For eddy probing on non-ref tools, use standard probe
            bed_z = self._do_tap_probe(probe_obj, samples)
        else:
            bed_z = self._do_tap_probe(probe_obj, samples)

        probe_z_offset = bed_z + current_pz - gcode_z_off

        self.probe_results[key]['probe_z_offset'] = probe_z_offset
        self.probe_results[key]['tap_bed_z'] = bed_z

        self.gcode.respond_info(
            "T%d: Tap bed_z=%.4f  probe_z_offset=%.4f"
            % (tool_nr, bed_z, probe_z_offset))

        if apply_offsets:
            try:
                tp = self.printer.lookup_object(
                    'tool_probe T%d' % tool_nr)
                tp.probe_offsets.z_offset = probe_z_offset
                configfile = self.printer.lookup_object('configfile')
                configfile.set('tool_probe T%d' % tool_nr,
                               'z_offset', '%.3f' % probe_z_offset)
                self.gcode.respond_info(
                    "T%d: z_offset applied (SAVE_CONFIG to persist)"
                    % tool_nr)
            except Exception as e:
                self.gcode.respond_info(
                    "T%d: could not apply z_offset: %s"
                    % (tool_nr, str(e)))

        toolhead.manual_move([None, None, z_hop], 10.)
        toolhead.wait_moves()

    # ── Restore ref_tool with its probe routing ──
    if self.toolchanger.active_tool.tool_number != ref_tool:
        self.gcode.run_script_from_command(
            "SELECT_TOOL T=%d RESTORE_AXIS=XZ" % ref_tool)
    self.gcode.run_script_from_command(
        "SET_ACTIVE_TOOL_PROBE T=%d" % ref_tool)

    # CHANGED: Restore ref probe routing from map (not hardcoded eddy)
    ref_restore = self._get_probe_for_tool(ref_tool, ref_tool)
    if self._is_eddy_probe(ref_restore):
        self.gcode.run_script_from_command(
            'SET_ACTIVE_Z_PROBE PROBE="%s"' % ref_restore)
    else:
        self.gcode.run_script_from_command(
            "SET_ACTIVE_Z_PROBE PROBE=none")

    # ── Summary ──
    self.gcode.respond_info("=== Probe Offset Calibration Complete ===")
    for tool_nr in calibrate_tools:
        key = str(tool_nr)
        data = self.probe_results[key]
        pzo = data.get('probe_z_offset', 0.0)
        zo = data.get('z_offset', 0.0)
        saved = " [APPLIED]" if apply_offsets else ""
        self.gcode.respond_info(
            "T%d: gcode_z_offset=%.4f  probe_z_offset=%.4f%s"
            % (tool_nr, zo, pzo, saved))
    if apply_offsets:
        self.gcode.respond_info(
            "Offsets applied at runtime. Use SAVE_CONFIG to persist.")
```

- [ ] **Step 4: Commit**

```bash
cd "D:\Claude Code\Offset"
git add klippy/extras/offset.py
git commit -m "feat: CALIBRATE_PROBE_OFFSETS uses probe_cal_map + REF_TOOL param"
```

---

### Task 3: Frontend — Replace tool-list with Accordion container in index.html

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Replace `<ul class="list-group" id="tool-list">` with accordion container**

In `index.html`, find line 206:

```html
<ul class="list-group" id="tool-list"></ul>
```

Replace with:

```html
<div class="accordion" id="offset-accordion"></div>
```

- [ ] **Step 2: Commit**

```bash
cd "D:\Claude Code\Offset"
git add index.html
git commit -m "refactor: replace tool-list ul with accordion container"
```

---

### Task 4: Frontend — Probe discovery + localStorage config in tools.js

**Files:**
- Modify: `js/tools.js`

**Context:** `tools.js` defines global functions used by `index.js`. Variables `printerIp` and `printerUrl()` are defined in `index.js` which loads after `tools.js`. All new globals go at the top of `tools.js`.

- [ ] **Step 1: Add probe state variables at the top of tools.js**

After the existing `let _uiZCalcSelection = "config";` line (line 18), add:

```javascript
// Probe calibration state
let _availableProbes = [];    // ["probe", "probe_eddy_ng my_eddy"]
let _probeCalConfig = null;   // { ref_tool, ref_probe, tool_probes: { "0": "probe", ... } }
```

- [ ] **Step 2: Add probe discovery function**

After the `OffsetDebug.init();` line (line 65), add:

```javascript
// --------------------------
// Probe Discovery
// --------------------------
function fetchAvailableProbes() {
  return $.get(printerUrl(printerIp, "/printer/objects/query?offset"))
    .then(function(data) {
      var st = data?.result?.status?.offset;
      _availableProbes = (st?.available_probes || []).filter(function(name) {
        return name && name.indexOf('tool_probe_endstop') === -1;
      });
      OffsetDebug.log("Available probes:", _availableProbes);
      return _availableProbes;
    })
    .catch(function() {
      _availableProbes = [];
      return [];
    });
}

function loadProbeCalConfig() {
  if (!printerIp) return;
  var key = 'offset_probe_config_' + printerIp.replace(/[^a-zA-Z0-9]/g, '_');
  try {
    _probeCalConfig = JSON.parse(localStorage.getItem(key));
  } catch (_) {
    _probeCalConfig = null;
  }
}

function saveProbeCalConfig() {
  if (!printerIp || !_probeCalConfig) return;
  var key = 'offset_probe_config_' + printerIp.replace(/[^a-zA-Z0-9]/g, '_');
  localStorage.setItem(key, JSON.stringify(_probeCalConfig));
}

function getProbeCalConfig(toolNumbers) {
  loadProbeCalConfig();
  if (_probeCalConfig && _probeCalConfig.tool_probes) return _probeCalConfig;

  // Build defaults
  var eddyProbe = _availableProbes.find(function(n) { return n.indexOf('eddy') !== -1; });
  var tapProbe = _availableProbes.find(function(n) { return n === 'probe'; }) || 'probe';
  var refTool = 0;
  var refProbe = eddyProbe || tapProbe;

  var toolProbes = {};
  (toolNumbers || []).forEach(function(t) {
    toolProbes[String(t)] = (t === refTool && eddyProbe) ? eddyProbe : tapProbe;
  });

  _probeCalConfig = {
    ref_tool: refTool,
    ref_probe: refProbe,
    tool_probes: toolProbes
  };
  saveProbeCalConfig();
  return _probeCalConfig;
}
```

- [ ] **Step 3: Commit**

```bash
cd "D:\Claude Code\Offset"
git add js/tools.js
git commit -m "feat: add probe discovery and localStorage config management"
```

---

### Task 5: Frontend — Refactor `getTools()` to build Accordion structure

**Files:**
- Modify: `js/tools.js`

**Context:** The current `getTools()` function (line 620) appends `masterToolItem` and `nonMasterToolItem` directly to `#tool-list`. We need to wrap them in accordion sections. The `calibrateButton()` output moves into accordion section 2. The new probe calibration section becomes section 3.

- [ ] **Step 1: Add accordion wrapper templates**

Before the existing `masterToolItem` template (line 145), add:

```javascript
// --------------------------
// Accordion Templates
// --------------------------
function accordionSection(id, title, statusHtml, contentHtml, defaultOpen) {
  var show = defaultOpen ? ' show' : '';
  var collapsed = defaultOpen ? '' : ' collapsed';
  return `
  <div class="accordion-item bg-body-tertiary border-secondary-subtle">
    <h2 class="accordion-header">
      <button class="accordion-button${collapsed} bg-body-tertiary py-2" type="button"
              data-bs-toggle="collapse" data-bs-target="#${id}-body"
              aria-expanded="${defaultOpen}" aria-controls="${id}-body">
        <span class="me-auto fw-bold">${title}</span>
        <span class="me-2 small" id="${id}-status">${statusHtml}</span>
      </button>
    </h2>
    <div id="${id}-body" class="accordion-collapse collapse${show}">
      <div class="accordion-body p-2">
        ${contentHtml}
      </div>
    </div>
  </div>`;
}
```

- [ ] **Step 2: Rewrite `getTools()` to build accordion**

Replace the entire `getTools()` function (starting at line 620) with:

```javascript
function getTools() {
  $.get(printerUrl(printerIp, "/printer/objects/query?toolchanger"))
    .done(function(data){

      var tool_names   = data.result.status.toolchanger.tool_names;
      var tool_numbers = data.result.status.toolchanger.tool_numbers;
      var active_tool  = data.result.status.toolchanger.tool_number;

      var master = computeDefaultRef(tool_numbers);

      // Build query for tool objects
      var queryUrl = "/printer/objects/query?";
      tool_names.forEach(function(name) { queryUrl += encodeURIComponent(name) + "&"; });
      queryUrl = queryUrl.slice(0,-1);

      $.get(printerUrl(printerIp, queryUrl))
        .done(function(toolData){

          // ── Build XY content ──
          var xyContent = '<ul class="list-group list-group-flush">';

          tool_numbers.forEach(function(tool_number, i){
            var toolObj = toolData.result.status[tool_names[i]];
            var cx = toolObj.gcode_x_offset.toFixed(3);
            var cy = toolObj.gcode_y_offset.toFixed(3);

            var disabled = tool_number !== active_tool ? "disabled" : "";
            var tc_disabled = tool_number === active_tool ? "disabled" : "";

            if (tool_number === master) {
              xyContent += masterToolItem({tool_number: tool_number, disabled: disabled, tc_disabled: tc_disabled});
            } else {
              xyContent += nonMasterToolItem({tool_number: tool_number, cx_offset: cx, cy_offset: cy, disabled: disabled, tc_disabled: tc_disabled});
            }
          });

          xyContent += '</ul>';

          // ── Build Z-cal content (fetched async) ──
          fetchOffsetStatus().then(function(){

            var zCalContent = calibrateButton(tool_numbers, _offsetPresent);

            // Z status text
            var zStatus = '';
            if (_offsetPresent && Object.keys( (typeof getProbeResults === 'function' ? {} : {}) ).length) {
              zStatus = '<span class="text-success">Ready</span>';
            } else if (_offsetPresent) {
              zStatus = '<span class="text-secondary">Ready</span>';
            } else {
              zStatus = '<span class="text-warning">Not available</span>';
            }

            // Probe results status for Z header
            var prKeys = Object.keys(_probeCalConfig?.tool_probes || {});
            var zHeaderStatus = _offsetPresent
              ? '<span class="text-secondary">Ready</span>'
              : '<span class="text-warning">offset module not found</span>';

            // ── Build Probe Cal content ──
            var probeCalContent = probeCalibrationSection(tool_numbers, _offsetPresent);

            // Probe cal status
            var probeStatus = '';
            if (!_offsetPresent) {
              probeStatus = '<span class="text-warning">offset module not found</span>';
            } else if (!Object.keys(( _probeCalConfig || {} ).tool_probes || {}).length) {
              probeStatus = '<span class="text-secondary">Not configured</span>';
            } else {
              probeStatus = '<span class="text-secondary">Configured</span>';
            }

            // ── Assemble accordion ──
            var $acc = $("#offset-accordion");
            $acc.html("");

            $acc.append(accordionSection(
              'accordion-xy',
              'XY Offsets',
              '<span class="text-success">Master: T' + master + '</span>',
              xyContent,
              true
            ));

            $acc.append(accordionSection(
              'accordion-zcal',
              'Z-Switch Calibration',
              zHeaderStatus,
              '<ul class="list-group list-group-flush">' + zCalContent + '</ul>',
              false
            ));

            $acc.append(accordionSection(
              'accordion-probecal',
              'Probe Offset Calibration',
              probeStatus,
              probeCalContent,
              false
            ));

            // Re-apply calibrate button state
            $(".calibrate-ref-checkbox").prop("checked", false);
            $("#calibrate-ref-" + master).prop("checked", true);
            $("#calibrate-tool-" + master).prop("checked", true);
            syncSelectAllState();

            $("#master-status-badge").text("Master: T" + master);

            if (_offsetPresent) $(".z-fields").removeClass("d-none");

            startProbeResultsUpdatesOnce();
            updateAllProbeResults();
          });
        })
        .fail(function(jqXHR){
          if (typeof showToast === 'function') showToast("Failed to load tool data: " + (jqXHR.statusText || "unknown"), "danger");
        });
    })
    .fail(function(jqXHR){
      if (typeof showToast === 'function') showToast("Failed to load tools: " + (jqXHR.statusText || "unknown"), "danger");
    });
}
```

- [ ] **Step 3: Commit**

```bash
cd "D:\Claude Code\Offset"
git add js/tools.js
git commit -m "refactor: getTools() builds accordion with XY, Z-cal, Probe-cal sections"
```

---

### Task 6: Frontend — Probe Calibration Section UI

**Files:**
- Modify: `js/tools.js`

- [ ] **Step 1: Add `probeCalibrationSection()` template function**

Add this after the `calibrateButton()` function:

```javascript
// --------------------------
// Probe Calibration Section
// --------------------------
function probeCalibrationSection(toolNumbers, enabled) {
  var sortedTools = toolNumbers.slice().sort(function(a, b) { return a - b; });
  var config = getProbeCalConfig(sortedTools);
  var btnClass = enabled ? "btn-primary" : "btn-secondary";
  var disabledAttr = enabled ? "" : "disabled";

  var probeOptions = function(selectedProbe) {
    return _availableProbes.map(function(p) {
      var sel = (p === selectedProbe) ? ' selected' : '';
      var label = p;
      if (p === 'probe') label = 'probe (Tap)';
      return '<option value="' + p + '"' + sel + '>' + label + '</option>';
    }).join('');
  };

  // Reference section
  var refToolOptions = sortedTools.map(function(t) {
    var sel = (t === config.ref_tool) ? ' selected' : '';
    return '<option value="' + t + '"' + sel + '>T' + t + '</option>';
  }).join('');

  var toolRows = sortedTools.map(function(t) {
    var isRef = (t === config.ref_tool);
    var currentProbe = config.tool_probes[String(t)] || 'probe';
    var refBadge = isRef
      ? '<span class="badge bg-success ms-2">REF</span>'
      : '';

    return '<div class="d-flex align-items-center gap-2 p-2 bg-dark rounded mb-1">' +
      '<div class="form-check mb-0">' +
        '<input class="form-check-input probe-cal-tool-cb" type="checkbox" value="' + t + '" id="probe-cal-tool-' + t + '" checked>' +
      '</div>' +
      '<span class="fw-bold text-nowrap" style="width:30px;">T' + t + '</span>' +
      '<select class="form-select form-select-sm probe-cal-probe-select" data-tool="' + t + '">' +
        probeOptions(currentProbe) +
      '</select>' +
      refBadge +
    '</div>';
  }).join('');

  return '<div class="container p-0">' +
    '<div class="border border-secondary-subtle rounded p-2 bg-dark mb-2">' +
      '<div class="d-flex justify-content-between align-items-center mb-2">' +
        '<span class="fs-6 fw-bold">Reference Probe</span>' +
      '</div>' +
      '<div class="row g-2">' +
        '<div class="col-4">' +
          '<label class="form-label small text-secondary mb-1">Tool</label>' +
          '<select class="form-select form-select-sm" id="probe-cal-ref-tool">' +
            refToolOptions +
          '</select>' +
        '</div>' +
        '<div class="col-8">' +
          '<label class="form-label small text-secondary mb-1">Probe</label>' +
          '<select class="form-select form-select-sm" id="probe-cal-ref-probe">' +
            probeOptions(config.ref_probe) +
          '</select>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="border border-secondary-subtle rounded p-2 bg-dark mb-2">' +
      '<div class="d-flex justify-content-between align-items-center mb-2">' +
        '<span class="fs-6 fw-bold">Tool Probes</span>' +
      '</div>' +
      toolRows +
    '</div>' +
    '<button class="btn ' + btnClass + ' w-100" id="probe-cal-btn" ' + disabledAttr + '>' +
      'CALIBRATE PROBE OFFSETS' +
    '</button>' +
  '</div>';
}
```

- [ ] **Step 2: Add event handlers for probe calibration UI**

Add after the existing `$(document).on("change", ".calibrate-ref-checkbox", ...)` block:

```javascript
// --------------------------
// Probe Calibration Events
// --------------------------

// Ref tool change
$(document).on("change", "#probe-cal-ref-tool", function() {
  if (!_probeCalConfig) return;
  _probeCalConfig.ref_tool = parseInt($(this).val(), 10);
  saveProbeCalConfig();
  // Re-render to update REF badges
  getTools();
});

// Ref probe change
$(document).on("change", "#probe-cal-ref-probe", function() {
  if (!_probeCalConfig) return;
  _probeCalConfig.ref_probe = $(this).val();
  // Also update the ref tool's probe in the map
  _probeCalConfig.tool_probes[String(_probeCalConfig.ref_tool)] = $(this).val();
  saveProbeCalConfig();
  getTools();
});

// Per-tool probe change
$(document).on("change", ".probe-cal-probe-select", function() {
  if (!_probeCalConfig) return;
  var tool = $(this).data("tool");
  _probeCalConfig.tool_probes[String(tool)] = $(this).val();
  saveProbeCalConfig();
});

// Calibrate button click
$(document).on("click", "#probe-cal-btn", function() {
  var config = getProbeCalConfig([]);
  if (!config) return;

  var selectedTools = $(".probe-cal-tool-cb:checked")
    .map(function() { return parseInt(this.value, 10); })
    .get()
    .filter(function(v) { return !Number.isNaN(v); });

  if (!selectedTools.length) {
    if (typeof showToast === 'function') showToast("No tools selected", "warning");
    return;
  }

  // Build GCode script: SET_PROBE_CAL_MAP per tool, then CALIBRATE
  var lines = [];
  selectedTools.forEach(function(t) {
    var probe = config.tool_probes[String(t)] || 'probe';
    lines.push('SET_PROBE_CAL_MAP TOOL=' + t + ' PROBE="' + probe + '"');
  });
  lines.push('CALIBRATE_PROBE_OFFSETS TOOLS=' + selectedTools.join(',') + ' REF_TOOL=' + config.ref_tool);

  var script = lines.join('\n');

  var $btn = $("#probe-cal-btn");
  $btn.prop("disabled", true).text("Calibrating...");
  if (typeof showToast === 'function') showToast("Probe calibration started...", "info");

  $.get(printerUrl(printerIp, "/printer/gcode/script?script=" + encodeURIComponent(script)))
    .done(function() {
      console.log("Probe calibration started:", script);
      if (typeof showToast === 'function') showToast("Probe calibration command sent", "success");
    })
    .fail(function(err) {
      console.error("Probe calibration failed:", err);
      var msg = "Probe calibration failed";
      try { msg += ": " + err.responseJSON.error.message; } catch(_){}
      if (typeof showToast === 'function') showToast(msg, "danger");
    })
    .always(function() {
      $btn.prop("disabled", false).text("CALIBRATE PROBE OFFSETS");
    });
});
```

- [ ] **Step 3: Commit**

```bash
cd "D:\Claude Code\Offset"
git add js/tools.js
git commit -m "feat: add probe calibration section UI with per-tool dropdowns and calibrate button"
```

---

### Task 7: Frontend — Wire probe discovery into connection flow

**Files:**
- Modify: `js/index.js`

**Context:** In `index.js`, the `connectCamera()` function (line 410) runs after the user selects a camera. It initializes the UI and starts the update cycle. We need to call `fetchAvailableProbes()` here.

- [ ] **Step 1: Add `fetchAvailableProbes()` call in `connectCamera()`**

Find the section in `connectCamera()` that starts with `// Start the update cycle` (around line 488). Currently:

```javascript
        // Start the update cycle
        updatePage();
        getTools();
        updateInterval = setInterval(updatePage, 1000);
```

Replace with:

```javascript
        // Fetch available probes, then start the update cycle
        fetchAvailableProbes().always(function() {
          updatePage();
          getTools();
          updateInterval = setInterval(updatePage, 1000);
        });
```

- [ ] **Step 2: Reset probe state on disconnect**

Find the disconnect handler section where `printerIp = '';` is set (around line 538). After `$('#BouncePositionBar, #BigPositionBar').empty();`, add:

```javascript
        // Reset probe state
        _availableProbes = [];
        _probeCalConfig = null;
```

- [ ] **Step 3: Commit**

```bash
cd "D:\Claude Code\Offset"
git add js/index.js
git commit -m "feat: wire probe discovery into connect/disconnect flow"
```

---

### Task 8: Manual Testing + Deploy

**Files:**
- All modified files

- [ ] **Step 1: Verify local UI loads correctly**

Open `D:\Claude Code\Offset\index.html` in a browser (or serve via `python -m http.server` from the Offset directory). Connect to the 250mm printer at `192.168.178.60`. Verify:

1. Accordion renders with 3 sections (XY Offsets open, Z-Switch and Probe Cal closed)
2. XY Offsets section shows Master T0 + T1-T3 tool rows (same as before)
3. Z-Switch Calibration section expands and shows existing calibration UI
4. Probe Offset Calibration section expands and shows:
   - Reference Probe: Tool dropdown (T0-T3), Probe dropdown (populated with `probe`, `probe_eddy_ng my_eddy`)
   - Per-tool rows with checkboxes and probe dropdowns
   - T0 has "REF" badge
   - "CALIBRATE PROBE OFFSETS" button
5. Multiple accordion sections can be open simultaneously

- [ ] **Step 2: Verify probe config persistence**

1. Change T1's probe to `probe_eddy_ng my_eddy`
2. Refresh the page, reconnect
3. Verify T1 still shows `probe_eddy_ng my_eddy` selected

- [ ] **Step 3: Deploy offset.py to printer**

```bash
scp "D:\Claude Code\Offset\klippy\extras\offset.py" biqu@192.168.178.60:/home/biqu/klipper/klippy/extras/offset.py
```

Restart Klipper:

```bash
ssh biqu@192.168.178.60 "sudo rm -rf /home/biqu/klipper/klippy/extras/__pycache__ && curl -s -X POST 'http://localhost:7125/machine/services/restart?service=klipper'"
```

Wait 10 seconds, then firmware restart:

```bash
ssh biqu@192.168.178.60 "curl -s -X POST http://localhost:7125/printer/firmware_restart"
```

- [ ] **Step 4: Verify SET_PROBE_CAL_MAP via GCode console**

In the Offset UI's GCode input, send:

```
SET_PROBE_CAL_MAP TOOL=0 PROBE="probe_eddy_ng my_eddy"
```

Expected: Console shows `Probe cal map: T0 -> probe_eddy_ng my_eddy`

Then verify in status:

```bash
curl -s "http://192.168.178.60/printer/objects/query?offset" | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d['result']['status']['offset'], indent=2))"
```

Expected: `probe_cal_map` shows `{"0": "probe_eddy_ng my_eddy"}` and `available_probes` lists the probes.

- [ ] **Step 5: Commit final state**

```bash
cd "D:\Claude Code\Offset"
git add -A
git status
git commit -m "feat: probe-per-tool config + accordion UI redesign complete"
```
