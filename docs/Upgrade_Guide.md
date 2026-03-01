# Upgrade Guide – Legacy → Global Master

## Major Changes

- Capture no longer bound to T0
- Offsets relative to selected Master
- Tool list rerenders dynamically
- Backend fallback for missing T0

## Upgrade Steps

1. Replace tools.js
2. Replace offset.py
3. Restart Klipper
4. Recalibrate all offsets

## Important

After upgrade, all previous offsets should be recalibrated.
