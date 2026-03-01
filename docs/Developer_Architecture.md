# Developer Architecture

## Frontend

File: js/tools.js

Key elements:
- offsetMasterTool (state)
- computeDefaultRef()
- applyMasterReferenceXY()
- Dynamic rerender via getTools()

## Backend

File: klippy/extras/offset.py

Key logic:
- cmd_CALIBRATE_ALL_Z_OFFSETS()
- Reference fallback validation
- Z trigger probing logic

## Data Flow

Toolchanger → Offset Backend → RAW values → Master transformation → Display
