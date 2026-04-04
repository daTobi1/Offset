# Offset – Global Master Calibration System

Professional multi-tool calibration framework for Klipper toolchanger systems.

---

## Core Features

- Global Master Tool architecture (X/Y/Z reference)
- Dynamic Capture UI per Master
- Relative XY offset transformation
- Robust Z referencing with fallback logic
- Median / Average / Trimmed Z calculation
- Toolchanger-safe workflow
- Backend reference validation
- Select-All calibration logic (Master protected)

### Web Interface

- **Klipper Console** – Real-time GCode output via WebSocket, shows last 50 messages on connect
- **Camera Position (CAM POS)** – Configurable X/Y/Z fields, pre-filled with bed center + Z=30, saved to localStorage
- **Toast Notifications** – Visual feedback for all actions (success/error/warning)
- **GCode Input** – Send arbitrary GCode commands with console output and error feedback
- **Camera Controls** – Zoom, contrast, horizontal/vertical flip
- **Movement Controls** – Fine (0.01–0.5mm) and coarse (1–50mm) bounce moves for X/Y/Z

---

## Master Tool Logic

Default behavior:

- If T0 exists → Master = T0
- Else → Master = smallest available tool

Master responsibilities:
- Reference for Z offsets
- Reference for XY offset display
- Only tool allowed to Capture position

---

## Z Offset Calculation

```
z_offset = z_trigger_tool - z_trigger_master
```

Master always receives:
```
z_offset = 0.000
```

---

## XY Offset Calculation

```
RAW_offset = (captured - current_offset) - typed_position
DISPLAY_offset = RAW_tool - RAW_master
```

Master always displays:
```
X = 0
Y = 0
```

---

## Documentation

See `/docs` folder for:

- Configuration Reference
- Upgrade Guide
- Developer Architecture
- Troubleshooting
- FAQ
- Release Notes

---

## Installation

Quick installation using curl:

```bash
curl -sSL https://raw.githubusercontent.com/daTobi1/Offset/main/install.sh | bash
```

The install script will:

- Create Python virtual environment
- Install required dependencies
- Set up the systemd service
- Configure Moonraker integration

### Uninstallation

Quick uninstall using curl:

```bash
curl -sSL https://raw.githubusercontent.com/daTobi1/Offset/main/uninstall.sh | bash
```

The uninstall script will:

- Stop and disable the Offset systemd service
- Remove the service file
- Remove the Offset installation directory
- Remove Moonraker service registration (moonraker.asvc)
- Remove the `[update_manager offset]` section from moonraker.conf
- Remove the Klipper extras symlink
- Restart Moonraker and Klipper

---

## Configuration

If you want to use automatic Z calibration, add the following to your `printer.cfg`:

```ini
[offset]

# -------------------------------------------------
# Web Interface
# -------------------------------------------------
# http://your-printer-ip:3000
# Example: http://192.168.178.60:3000/

# -------------------------------------------------
# Probe / Z-Switch
# -------------------------------------------------
pin: PG10                      # Endstop pin

# Z-switch trigger position (XY)
zswitch_x_pos: 31.35
zswitch_y_pos: -4.61

# Z height at which the switch triggers
zswitch_z_pos: 3.0

# -------------------------------------------------
# Safety / Motion Settings
# -------------------------------------------------
# Lift above trigger height before every probe
# Start-Z = max(zswitch_z_pos + lift_z, safe_start_z)
lift_z: 5.0

# Absolute minimum start Z height
safe_start_z: 7.0

# Movement speeds (conservative = less bouncing)
move_speed: 80
z_move_speed: 6

# -------------------------------------------------
# Sampling / Accuracy
# -------------------------------------------------
# Target number of samples per batch
samples: 5 # If using trimmed, this count must be minimum 5

# Maximum allowed deviation within a batch (mm)
samples_tolerance: 0.005

# Maximum attempts if tolerance is not reached immediately
samples_max_count: 20

# Z-offset calculation method per sample batch:
#   median   = robust against outliers (recommended)
#   average  = mean value (smoother, but sensitive to outliers)
#   trimmed  = trimmed mean (removes extreme values on both ends)
z_calc_method: trimmed

# For "trimmed" mode: number of values removed per side
z_trim_count: 1

# -------------------------------------------------
# Recovery against "Probe triggered prior to movement"
# -------------------------------------------------
# Additional Z lift between EACH sample
recover_lift_mm: 3.0

# Short pause after recovery lift (ms)
recover_pause_ms: 150

# Maximum recovery attempts per sample
recover_max_attempts: 4

# -------------------------------------------------
# Macros (executed with context)
# -------------------------------------------------
start_gcode:
  M118 Starting calibration
  G28
  QUAD_GANTRY_LEVEL
  G28 Z

before_pickup_gcode:
  M118 Before pickup

after_pickup_gcode:
  M118 After pickup

finish_gcode:
  M118 Calibration complete
```

### Finding the Endstop Position

To correctly configure the endstop position for Z calibration:

1. Home your printer with T0 selected
2. Using the jog controls in your printer interface, carefully position the nozzle directly centered over the endstop pin
3. Note the current X, Y, and Z positions displayed in your interface
4. Use these values for `zswitch_x_pos` and `zswitch_y_pos` in your configuration
5. For `zswitch_z_pos`, add 3mm to your current Z position (if using multiple hotends of varying lengths, add additional clearance as needed)

Example: If your position readings are X:226.71, Y:-18.46, Z:4.8, then configure:
```ini
zswitch_x_pos: 226.71
zswitch_y_pos: -18.46
zswitch_z_pos: 7.8  # 4.8 + 3mm clearance
```

### G-code Macro Options

Offset supports templated G-code macros with full Jinja template support.

- **start_gcode**: Executed at the beginning of calibration
- **before_pickup_gcode**: Executed before each tool change
- **after_pickup_gcode**: Executed after each tool change
- **finish_gcode**: Executed after calibration is complete

---

## Project Structure

```
Offset/
  app.py              # Flask server (serves web UI on port 3000)
  index.html          # Main dashboard
  js/
    index.js          # Core logic, connection, movement, toast system
    tools.js          # Tool rendering, offset calculations, calibration
    gcode.js          # GCode input + Klipper console (WebSocket)
    camera.js         # Camera controls (zoom, flip, contrast)
  css/
    camera.css        # Camera overlay styling
  klippy/
    extras/
      offset.py       # Klipper module for Z calibration
  install.sh          # Installation script
  uninstall.sh        # Uninstallation script
```

---

## Credits & Original Project

Offset is a modified and extended implementation based on the original Offset project by nic335.

This project builds upon the idea and foundation of Offset and extends it with additional features, structural changes, and further development.

- **Original Author:** nic335
- **Original Repository:** https://github.com/nic335/Offset

Huge thanks to nic335 for creating Offset and making it available under the MIT License.

---

## License

This project is released under the MIT License, consistent with the original Offset project.

The original copyright notice and license are preserved. Attribution to the original author is maintained.

See the [LICENSE](LICENSE) file for full details.

---

## Disclaimer

This is not the official Offset repository.
For the original implementation, please visit: https://github.com/nic335/Offset
