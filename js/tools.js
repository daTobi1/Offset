/* =========================================================
   Offset tools.js (Global Master + Config-default Z calc)
   - Fixes: updateTools is defined (used by index.js)
   - Z calc dropdown:
       Default = Config (offset.cfg)
       Label shows offset status z_calc_method (e.g. trimmed)
       Only sends Z_CALC if user explicitly overrides
   ========================================================= */

let offsetMasterTool = null;
let _probeInterval = null;

// Offset status cache
let _offsetPresent = false;
let _offsetZCalcDefault = null; // "median" | "average" | "trimmed" | null

// Remember UI dropdown selection across rerenders
let _uiZCalcSelection = "config"; // "config" | "median" | "average" | "trimmed"

// --------------------------
// Helpers
// --------------------------
function printerUrl(ip, path) { return `http://${ip}${path}`; }

function computeDefaultRef(toolNumbers) {
  const sorted = [...toolNumbers].sort((a, b) => a - b);
  if (offsetMasterTool !== null && sorted.includes(offsetMasterTool)) return offsetMasterTool;
  if (sorted.includes(0)) return 0;
  return sorted.length ? sorted[0] : 0;
}

function getSelectedReferenceTool(fallback = 0) {
  const $checked = $(".calibrate-ref-checkbox:checked").first();
  if ($checked.length) {
    const v = parseInt($checked.val(), 10);
    return Number.isNaN(v) ? fallback : v;
  }
  return offsetMasterTool ?? fallback;
}

function syncSelectAllState() {
  const $all = $(".calibrate-tool-checkbox");
  const $checked = $(".calibrate-tool-checkbox:checked");
  $("#calibrate-select-all").prop("checked", $all.length > 0 && $all.length === $checked.length);
}

function formatClipboardNumber(value) {
  if (!Number.isFinite(value)) return null;
  return value.toFixed(3);
}

function copyTextToClipboard(text) {
  function legacyExecCopy() {
    return new Promise(function(resolve, reject) {
      const $tmp = $('<textarea readonly>');
      $tmp
        .val(text)
        .css({position: 'fixed', left: '0', top: '0', opacity: '0', pointerEvents: 'none'})
        .attr('aria-hidden', 'true');

      $('body').append($tmp);
      const el = $tmp.get(0);

      try {
        el.focus();
        el.select();
        el.setSelectionRange(0, el.value.length);

        const ok = document.execCommand('copy');
        $tmp.remove();
        if (ok) resolve();
        else reject(new Error('copy failed'));
      } catch (err) {
        $tmp.remove();
        reject(err);
      }
    });
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).catch(function() {
      return legacyExecCopy();
    });
  }

  return legacyExecCopy();
}

function readNewOffsetValue(tool, axis) {
  const $el = $(`#T${tool}-${axis}-new`);
  if (!$el.length) return null;

  const rawAttr = $el.attr("data-raw");
  const rawText = (rawAttr !== undefined && rawAttr !== "")
    ? rawAttr
    : $el.find(":first-child").text();

  const numeric = parseFloat(rawText);
  if (Number.isNaN(numeric)) return null;
  return formatClipboardNumber(numeric);
}

function applyMasterReferenceXY(axis) {
  const master = getSelectedReferenceTool(0);
  const $masterEl = $(`#T${master}-${axis}-new`);
  const masterRaw = parseFloat($masterEl.attr("data-raw")) || 0.0;

  $('button#toolchange').each(function(){
    const tool = $(this).data("tool");
    const $el = $(`#T${tool}-${axis}-new`);
    if (!$el.length) return; // master row has no XY new fields
    const raw = parseFloat($el.attr("data-raw")) || 0.0;
    const rel = (parseInt(tool, 10) === parseInt(master, 10)) ? 0.0 : (raw - masterRaw);
    $el.find('>:first-child').text(rel.toFixed(3));
  });
}

// --------------------------
// Templates
// --------------------------
const masterToolItem = ({tool_number, disabled, tc_disabled}) => `
<li class="list-group-item bg-body-tertiary p-2">
  <div class="container">
    <div class="row">
      <div class="col-2">
        <button type="button" class="btn btn-secondary btn-sm w-100 h-100 ${tc_disabled}"
                id="toolchange" name="T${tool_number}" data-tool="${tool_number}">
          <h1>T${tool_number}</h1>
        </button>
      </div>

      <div class="col-6">
        <div class="border border-secondary-subtle rounded p-2 bg-dark h-100 d-flex flex-column justify-content-center">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <span class="fs-6">Master Capture</span>
            <small class="text-secondary" id="master-status-badge">Master: T${tool_number}</small>
          </div>
          <button type="button"
                  class="btn btn-sm btn-secondary fs-6 border text-center w-100 ${disabled}"
                  style="padding-bottom:10px; padding-top:10px;"
                  id="capture-pos">
            CAPTURE <br/> CURRENT <br/> POSITION
          </button>
          <small class="text-secondary mt-2">
            Tip: switch to Master tool first (tool must be active).
          </small>
        </div>
      </div>

      <div class="col-4">
        <div class="border border-secondary-subtle rounded p-2 bg-dark h-100">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <span class="fs-6">Captured Position</span>
          </div>

          <div class="row">
            <div class="col-4"><small>X:</small></div>
            <div class="col-8 text-end"><span id="captured-x"><small></small></span></div>
          </div>
          <div class="row">
            <div class="col-4"><small>Y:</small></div>
            <div class="col-8 text-end"><span id="captured-y"><small></small></span></div>
          </div>
          <div class="row">
            <div class="col-4"><small>Z:</small></div>
            <div class="col-8 text-end"><span id="captured-z"><small></small></span></div>
          </div>

          <hr class="my-2"/>

          <div class="row">
            <div class="col-6"><small>Z-Trigger:</small></div>
            <div class="col-6 text-end"><span id="T${tool_number}-z-trigger"><small>-</small></span></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</li>
`;

const nonMasterToolItem = ({tool_number, cx_offset, cy_offset, disabled, tc_disabled}) => `
<li class="list-group-item bg-body-tertiary p-2">
  <div class="container">
    <div class="row">

      <div class="col-2">
        <button type="button" class="btn btn-secondary btn-sm w-100 h-100 ${tc_disabled}"
                id="toolchange" name="T${tool_number}" data-tool="${tool_number}">
          <h1>T${tool_number}</h1>
        </button>
      </div>

      <div class="col-6">
        <div class="row pb-3">
          <div class="input-group ps-1 pe-1">
            <button class="btn btn-secondary ${disabled}" type="button"
                    id="T${tool_number}-fetch-x" data-axis="x" data-tool="${tool_number}">X</button>
            <input type="number" name="T${tool_number}-x-pos"
                   class="form-control"
                   placeholder="0.0"
                   data-axis="x"
                   data-tool="${tool_number}"
                   ${disabled}>
          </div>
        </div>

        <div class="row">
          <div class="input-group ps-1 pe-1">
            <button class="btn btn-secondary ${disabled}" type="button"
                    id="T${tool_number}-fetch-y" data-axis="y" data-tool="${tool_number}">Y</button>
            <input type="number" name="T${tool_number}-y-pos"
                   class="form-control"
                   placeholder="0.0"
                   data-axis="y"
                   data-tool="${tool_number}"
                   ${disabled}>
          </div>
        </div>
      </div>

      <div class="col-4 border rounded bg-dark">
        <div class="row">
          <div class="col-6 pt-2 pb-2">
            <div class="row pb-1">
              <span class="fs-6 lh-sm text-secondary"><small>Current X</small></span>
              <span class="fs-5 lh-sm text-secondary" id="T${tool_number}-x-offset"><small>${cx_offset}</small></span>
            </div>
            <div class="row">
              <span class="fs-6 lh-sm text-secondary"><small>Current Y</small></span>
              <span class="fs-5 lh-sm text-secondary" id="T${tool_number}-y-offset"><small>${cy_offset}</small></span>
            </div>

            <div class="z-fields d-none mt-2">
              <div class="row">
                <span class="fs-6 lh-sm text-secondary"><small>Z-Trigger</small></span>
                <span class="fs-5 lh-sm text-secondary" id="T${tool_number}-z-trigger"><small>-</small></span>
              </div>
            </div>
          </div>

          <div class="col-6 pt-2 pb-2">
            <div class="row pb-1">
              <span class="fs-6 lh-sm"><small>New X</small></span>
              <span class="fs-5 lh-sm" id="T${tool_number}-x-new" data-raw="0.000" title="Click to copy gcode_x_offset" style="cursor:pointer;"><small>0.000</small></span>
            </div>
            <div class="row pb-1">
              <span class="fs-6 lh-sm"><small>New Y</small></span>
              <span class="fs-5 lh-sm" id="T${tool_number}-y-new" data-raw="0.000" title="Click to copy gcode_y_offset" style="cursor:pointer;"><small>0.000</small></span>
            </div>
            <div class="row pb-1">
              <span class="fs-6 lh-sm"><small>New Z</small></span>
              <span class="fs-5 lh-sm" id="T${tool_number}-z-new" data-raw="0.000" title="Click to copy gcode_z_offset" style="cursor:pointer;"><small>0.000</small></span>
            </div>
            <div class="row pt-1">
              <button type="button" class="btn btn-sm btn-outline-secondary" data-copy-all="${tool_number}">Copy all offsets</button>
            </div>
          </div>
        </div>
      </div>

    </div>
  </div>
</li>
`;

// --------------------------
// Offset status fetch (for dropdown label + z fields)
// --------------------------
function fetchOffsetStatus() {
  return $.get(printerUrl(printerIp, "/printer/objects/query?offset"))
    .then(function(ax){
      const st = ax?.result?.status?.offset;
      _offsetPresent = !!st;
      _offsetZCalcDefault = (st?.z_calc_method || null);
      return st || null;
    })
    .catch(function(){
      _offsetPresent = false;
      _offsetZCalcDefault = null;
      return null;
    });
}

// --------------------------
// Probe results (Z)
// --------------------------
function getProbeResults() {
  return $.get(printerUrl(printerIp, "/printer/objects/query?offset"))
    .then(data => data?.result?.status?.offset?.probe_results || {})
    .catch(() => ({}));
}

function updateProbeResults(tool, probeResults) {
  if (!probeResults || !probeResults[tool]) return;
  const r = probeResults[tool];
  if (typeof r.z_trigger === "number") $(`#T${tool}-z-trigger small`).text(r.z_trigger.toFixed(3));
  if (typeof r.z_offset === "number") {
    const zTxt = r.z_offset.toFixed(3);
    $(`#T${tool}-z-new`).attr("data-raw", zTxt);
    $(`#T${tool}-z-new small`).text(zTxt);
  }
}

function updateAllProbeResults() {
  getProbeResults().then(function(probeResults) {
    $('button#toolchange').each(function(){
      updateProbeResults($(this).data("tool"), probeResults);
    });
  });
}

function startProbeResultsUpdatesOnce() {
  if (_probeInterval) return;
  _probeInterval = setInterval(updateAllProbeResults, 2000);
}

// --------------------------
// Calibration UI
// --------------------------
function calibrateButton(toolNumbers = [], enabled = false) {
  const sortedTools = [...toolNumbers].sort((a, b) => a - b);
  const defaultRef = computeDefaultRef(sortedTools);

  const toolsMarkup = sortedTools.map(t => `
    <div class="form-check form-check-inline me-3 mb-1">
      <input class="form-check-input calibrate-tool-checkbox" type="checkbox" id="calibrate-tool-${t}" value="${t}" checked>
      <label class="form-check-label" for="calibrate-tool-${t}">T${t}</label>
    </div>
  `).join("");

  const refMarkup = sortedTools.map(t => `
    <div class="form-check form-check-inline me-3 mb-1">
      <input class="form-check-input calibrate-ref-checkbox" type="checkbox" id="calibrate-ref-${t}" value="${t}" ${t === defaultRef ? "checked" : ""}>
      <label class="form-check-label" for="calibrate-ref-${t}">T${t}</label>
    </div>
  `).join("");

  const btnClass = enabled ? "btn-primary" : "btn-secondary";
  const disabledAttr = enabled ? "" : "disabled";

  const cfg = (_offsetZCalcDefault || "unknown").toLowerCase();
  const cfgLabel = `Config (offset.cfg: ${cfg})`;

  const sel = (_uiZCalcSelection || "config").toLowerCase();
  const selConfig = sel === "config" ? "selected" : "";
  const selMedian = sel === "median" ? "selected" : "";
  const selAvg    = sel === "average" ? "selected" : "";
  const selTrim   = sel === "trimmed" ? "selected" : "";

  return `
<li class="list-group-item bg-body-tertiary p-2">
  <div class="container">
    <div class="row pb-2">
      <div class="col-12">
        <div class="border border-secondary-subtle rounded p-2 bg-dark">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <span class="fs-6">Tools to calibrate</span>
            <div class="form-check mb-0">
              <input class="form-check-input" type="checkbox" id="calibrate-select-all" checked>
              <label class="form-check-label" for="calibrate-select-all"><small class="text-secondary">Select all</small></label>
            </div>
          </div>
          <div>${toolsMarkup}</div>
        </div>
      </div>
    </div>

    <div class="row pb-2">
      <div class="col-12">
        <div class="border border-secondary-subtle rounded p-2 bg-dark">
          <div class="d-flex justify-content-between align-items-center mb-1">
            <span class="fs-6">Reference (Master) tool</span>
            <small class="text-secondary">Default: ${defaultRef === 0 ? "T0" : `T${defaultRef}`}</small>
          </div>
          <div>${refMarkup}</div>
        </div>
      </div>
    </div>

    <div class="row pb-2">
      <div class="col-12">
        <div class="border border-secondary-subtle rounded p-2 bg-dark">
          <div class="d-flex justify-content-between align-items-center mb-1">
            <span class="fs-6">Z calculation</span>
            <small class="text-secondary">Default = Config</small>
          </div>
          <select id="z-calc-method" class="form-select form-select-sm w-auto d-inline-block">
            <option value="config" ${selConfig}>${cfgLabel}</option>
            <option value="median" ${selMedian}>Median</option>
            <option value="average" ${selAvg}>Average</option>
            <option value="trimmed" ${selTrim}>Trimmed mean</option>
          </select>
        </div>
      </div>
    </div>

    <div class="row">
      <div class="col-12">
        <button class="btn ${btnClass} w-100" id="calibrate-all-btn" ${disabledAttr}>
          CALIBRATE Z-OFFSETS
        </button>
      </div>
    </div>
  </div>
</li>`;
}

// Remember dropdown selection
$(document).on("change", "#z-calc-method", function(){
  _uiZCalcSelection = ($(this).val() || "config").toLowerCase();
});

// Calibrate click
$(document).on("click", "#calibrate-all-btn", function() {
  const selectedTools = $(".calibrate-tool-checkbox:checked")
    .map(function(){ return parseInt(this.value, 10); })
    .get()
    .filter(v => !Number.isNaN(v));

  const refTool = getSelectedReferenceTool(0);
  if (!selectedTools.includes(refTool)) selectedTools.unshift(refTool);

  const method = ($("#z-calc-method").val() || "config").toLowerCase();

  // Only send override if not config
  const zCalcPart = (method !== "config") ? ` Z_CALC=${method}` : "";
  const script = `CALIBRATE_ALL_Z_OFFSETS TOOLS=${selectedTools.join(",")}${zCalcPart} REF=${refTool}`;

  $.get(printerUrl(printerIp, `/printer/gcode/script?script=${encodeURIComponent(script)}`))
    .done(() => console.log("Calibration started:", script))
    .fail(err => console.error("Calibration failed:", err));
});

$(document).on("click", "span[id$='-x-new'], span[id$='-y-new'], span[id$='-z-new']", function(event) {
  const $offsetEl = $(event.target).closest("span[id$='-x-new'], span[id$='-y-new'], span[id$='-z-new']");
  if (!$offsetEl.length) return;

  const id = $offsetEl.attr("id") || "";
  const match = id.match(/^T(\d+)-([xyz])-new$/u);
  if (!match) return;

  const tool = match[1];
  const axis = match[2];
  const value = readNewOffsetValue(tool, axis);
  if (value === null) return;

  const payload = `gcode_${axis}_offset: ${value}`;
  copyTextToClipboard(payload)
    .then(function() {
      console.log(`Copied ${payload}`);
    })
    .catch(function(err) {
      console.error('Clipboard copy failed:', err);
    });
});

$(document).on("click", "button[data-copy-all]", function() {
  const tool = $(this).attr("data-copy-all");
  if (tool === undefined || tool === "") return;

  const xValue = readNewOffsetValue(tool, "x");
  const yValue = readNewOffsetValue(tool, "y");
  const zValue = readNewOffsetValue(tool, "z");

  if (xValue === null || yValue === null || zValue === null) return;

  const payload = [
    `gcode_x_offset: ${xValue}`,
    `gcode_y_offset: ${yValue}`,
    `gcode_z_offset: ${zValue}`
  ].join("\n");

  copyTextToClipboard(payload)
    .then(function() {
      console.log(`Copied all offsets for T${tool}`);
    })
    .catch(function(err) {
      console.error('Clipboard copy failed:', err);
    });
});

// Select all
$(document).on("change", "#calibrate-select-all", function () {
  const checked = $(this).is(":checked");
  $(".calibrate-tool-checkbox").prop("checked", checked);
  const refTool = getSelectedReferenceTool(0);
  $(`#calibrate-tool-${refTool}`).prop("checked", true);
  syncSelectAllState();
});

$(document).on("change", ".calibrate-tool-checkbox", function () {
  const refTool = getSelectedReferenceTool(0);
  $(`#calibrate-tool-${refTool}`).prop("checked", true);
  syncSelectAllState();
});

$(document).on("change", ".calibrate-ref-checkbox", function () {
  $(".calibrate-ref-checkbox").not(this).prop("checked", false);
  $(this).prop("checked", true);

  const refVal = parseInt($(this).val(), 10);
  if (!Number.isNaN(refVal)) offsetMasterTool = refVal;

  $(`#calibrate-tool-${refVal}`).prop("checked", true);

  // Rerender so Master row moves
  getTools();
});

// --------------------------
// Tool change URL (used by index.js)
// --------------------------
function toolChangeURL(tool) {
  let x_pos = parseFloat($("#captured-x").find(":first-child").text());
  let y_pos = parseFloat($("#captured-y").find(":first-child").text());
  let z_pos = parseFloat($("#captured-z").find(":first-child").text());

  if (Number.isNaN(x_pos) || Number.isNaN(y_pos) || Number.isNaN(z_pos)) {
    let url = printerUrl(printerIp, "/printer/gcode/script?script=OFFSET_BEFORE_PICKUP_GCODE");
    url += "%0AT" + tool;
    url += "%0AOFFSET_AFTER_PICKUP_GCODE";
    return url;
  }

  const master = getSelectedReferenceTool(0);
  if (String(tool) !== String(master)) {
    const rawX = $(`input[name=T${tool}-x-pos]`).val();
    const rawY = $(`input[name=T${tool}-y-pos]`).val();
    const tool_x = parseFloat(rawX);
    const tool_y = parseFloat(rawY);

    const hasX = rawX !== "" && rawX !== undefined && !Number.isNaN(tool_x);
    const hasY = rawY !== "" && rawY !== undefined && !Number.isNaN(tool_y);

    if (hasX && hasY) {
      x_pos = tool_x;
      y_pos = tool_y;
    }
  }

  x_pos = x_pos.toFixed(3);
  y_pos = y_pos.toFixed(3);
  z_pos = z_pos.toFixed(3);

  let url = printerUrl(printerIp, "/printer/gcode/script?script=OFFSET_BEFORE_PICKUP_GCODE");
  url += "%0AT" + tool;
  url += "%0AOFFSET_AFTER_PICKUP_GCODE";
  url += "%0ASAVE_GCODE_STATE NAME=RESTORE_POS";
  url += "%0AG90";
  url += "%0AG0 Z" + z_pos + " F3000";
  url += "%0AG0 X" + x_pos + " Y" + y_pos + " F12000";
  url += "%0ARESTORE_GCODE_STATE NAME=RESTORE_POS";
  return url;
}

// --------------------------
// Tool list loader (called by index.js)
// --------------------------
function getTools() {
  $.get(printerUrl(printerIp, "/printer/objects/query?toolchanger"))
    .done(function(data){

      const tool_names   = data.result.status.toolchanger.tool_names;
      const tool_numbers = data.result.status.toolchanger.tool_numbers;
      const active_tool  = data.result.status.toolchanger.tool_number;

      const master = computeDefaultRef(tool_numbers);

      // Build query for tool objects
      let queryUrl = "/printer/objects/query?";
      tool_names.forEach(name => queryUrl += name + "&");
      queryUrl = queryUrl.slice(0,-1);

      $.get(printerUrl(printerIp, queryUrl))
        .done(function(toolData){

          $("#tool-list").html("");

          tool_numbers.forEach(function(tool_number, i){
            const toolObj = toolData.result.status[tool_names[i]];
            const cx = toolObj.gcode_x_offset.toFixed(3);
            const cy = toolObj.gcode_y_offset.toFixed(3);

            const disabled = tool_number !== active_tool ? "disabled" : "";
            const tc_disabled = tool_number === active_tool ? "disabled" : "";

            if (tool_number === master) {
              $("#tool-list").append(masterToolItem({tool_number, disabled, tc_disabled}));
            } else {
              $("#tool-list").append(nonMasterToolItem({tool_number, cx_offset: cx, cy_offset: cy, disabled, tc_disabled}));
            }
          });

          // Fetch offset status for cfg method label + enable button
          fetchOffsetStatus().then(function(){
            $("#tool-list").append(calibrateButton(tool_numbers, _offsetPresent));

            // Set reference checkbox to master
            $(".calibrate-ref-checkbox").prop("checked", false);
            $(`#calibrate-ref-${master}`).prop("checked", true);

            // Ensure master included
            $(`#calibrate-tool-${master}`).prop("checked", true);
            syncSelectAllState();

            // Badge
            $("#master-status-badge").text(`Master: T${master}`);

            // Show z-fields if offset present
            if (_offsetPresent) $('.z-fields').removeClass('d-none');

            startProbeResultsUpdatesOnce();
            updateAllProbeResults();
          });
        });
    });
}

// --------------------------
// Offset calc (used by index.js handlers)
// --------------------------
function updateOffset(tool, axis) {
  const $newEl = $(`#T${tool}-${axis}-new`);
  if (!$newEl.length) return;

  const rawPosition = $(`input[name=T${tool}-${axis}-pos]`).val();
  const position = parseFloat(rawPosition);
  const hasPosition = rawPosition !== "" && rawPosition !== undefined && !Number.isNaN(position);
  const capturedText = $(`#captured-${axis}`).find(":first-child").text();
  const captured_pos = parseFloat(capturedText);
  const old_offset = parseFloat($(`#T${tool}-${axis}-offset`).text());

  if (hasPosition && capturedText !== "" && !Number.isNaN(captured_pos) && !Number.isNaN(old_offset)) {

    let new_offset = (captured_pos - old_offset) - position;

    // Preserve your sign-flip behavior
    if (new_offset < 0) new_offset = Math.abs(new_offset);
    else new_offset = -new_offset;

    const rawTxt = new_offset.toFixed(3);
    $newEl.attr("data-raw", rawTxt);
    $newEl.find(">:first-child").text(rawTxt);
  } else {
    $newEl.attr("data-raw", "0.000");
    $newEl.find(">:first-child").text("0.0");
  }

  applyMasterReferenceXY(axis);
}

// --------------------------
// REQUIRED by index.js updatePage()
// --------------------------
function updateTools(tool_numbers, tool_number_active) {
  const master = getSelectedReferenceTool(0);
  const activeTool = parseInt(tool_number_active, 10);

  // Capture button enabled only if master tool is active
  const $captureBtn = $("#capture-pos");
  if ($captureBtn.length) {
    if (activeTool !== parseInt(master, 10)) {
      $captureBtn.addClass("disabled").prop("disabled", true);
    } else {
      $captureBtn.removeClass("disabled").prop("disabled", false);
    }
  }

  // Keep tool row controls synced with currently loaded tool.
  // Only the active tool may fetch/write XY values.
  (tool_numbers || []).forEach((tool_no) => {
    const isActive = parseInt(tool_no, 10) === activeTool;

    $(`#T${tool_no}-fetch-x, #T${tool_no}-fetch-y`)
      .toggleClass("disabled", !isActive)
      .prop("disabled", !isActive);

    $(`input[name=T${tool_no}-x-pos], input[name=T${tool_no}-y-pos]`)
      .prop("disabled", !isActive);

    // Active tool cannot be selected again.
    const $tcBtn = $(`button#toolchange[data-tool=${tool_no}]`);
    $tcBtn.toggleClass("disabled", isActive).prop("disabled", isActive);

    updateOffset(tool_no, "x");
    updateOffset(tool_no, "y");
  });
}
