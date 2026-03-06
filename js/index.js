// Global variables and utility functions
let printerIp = '';
let WebcamPath = '/webcam?action=stream';
let updateInterval = null;

function printerUrl(ip, endpoint) {
    ip = ip.replace(/^https?:\/\//, '');
    return `http://${ip}${endpoint}`;
}

function isValidIP(input) {
    input = input.trim();
    if (!input) return false;
    input = input.replace(/^https?:\/\//, '');
    const urlRegex = /^[a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9](:[0-9]+)?$/;
    return urlRegex.test(input);
}

function updatePage() {
    $.get(printerUrl(printerIp, "/printer/objects/query?gcode_move&toolhead&toolchanger&quad_gantry_level&stepper_enable"), function(data){
        if (data['result']) {
            var positions   = data['result']['status']['gcode_move']['position'];
            var gcode_pos   = data['result']['status']['gcode_move']['gcode_position'];
            var homed       = data['result']['status']['toolhead']['homed_axes'] === "xyz";
            var qgl_done    = data['result']['status']['quad_gantry_level']['applied'];
            var steppers    = data['result']['status']['stepper_enable']['steppers'];
            var tool_number = data['result']['status']['toolchanger']['tool_number'];
            var tools       = data['result']['status']['toolchanger']['tool_numbers'];

            updatePositions(positions, gcode_pos);
            updateHoming(homed);
            updateQGL(qgl_done);
            updateMotor(checkActiveStepper(steppers));
            updateTools(tools, tool_number);
        }
    });
}

function updatePositions(positions, gcode_pos){
    if ($("#pos-x").text() !== gcode_pos[0].toFixed(3)) $("#pos-x").text(gcode_pos[0].toFixed(3));
    if ($("#pos-y").text() !== gcode_pos[1].toFixed(3)) $("#pos-y").text(gcode_pos[1].toFixed(3));
    if ($("#pos-z").text() !== gcode_pos[2].toFixed(3)) $("#pos-z").text(gcode_pos[2].toFixed(3));
}

function updateHoming(homed) {
    $("#home-all").data("homed", homed);
    if (homed) {
        replaceClass("#home-all",      "btn-danger",  "btn-primary");
        replaceClass("#home-fine-x",   "btn-dark",    "btn-primary");
        replaceClass("#home-fine-y",   "btn-dark",    "btn-primary");
        replaceClass("#home-course-x", "btn-dark",    "btn-primary");
        replaceClass("#home-course-y", "btn-dark",    "btn-primary");
        replaceClass("#home-course-z", "btn-dark",    "btn-primary");
    } else {
        replaceClass("#home-all",      "btn-primary", "btn-danger");
        replaceClass("#home-fine-x",   "btn-primary", "btn-dark");
        replaceClass("#home-fine-y",   "btn-primary", "btn-dark");
        replaceClass("#home-course-x", "btn-primary", "btn-dark");
        replaceClass("#home-course-y", "btn-primary", "btn-dark");
        replaceClass("#home-course-z", "btn-primary", "btn-dark");
    }
}

function updateQGL(qgl_done) {
    $("#qgl").data("qgl", qgl_done);
    if (qgl_done) replaceClass("#qgl", "btn-danger", "btn-primary");
    else          replaceClass("#qgl", "btn-primary", "btn-danger");
}

function updateMotor(enabled) {
    $("#disable-motors").data("motoron", enabled);
    if (enabled) replaceClass("#disable-motors", "btn-danger",  "btn-primary");
    else         replaceClass("#disable-motors", "btn-primary", "btn-danger");
}

function checkActiveStepper(array) {
    var result = false;
    $.each(array, function(key, value) {
        if (value === true) { result = true; return false; }
    });
    return result;
}

function replaceClass(id, old_class, new_class) {
    if ($(id).hasClass(old_class)) {
        $(id).removeClass(old_class).addClass(new_class);
    }
}

const bouncesComands = [
    'SAVE_GCODE_STATE NAME=bounce_move',
    'G91',
    '-bounce-',
    'RESTORE_GCODE_STATE NAME=bounce_move'
];

// FIX: build script as plain text then encodeURIComponent()
// Previously had raw %0A and unencoded spaces -> malformed URLs
function ComandsUrl(axis, value) {
    let script = '';
    let bounce, move;

    if (value > 0) {
        bounce =  value + 0.5;
        move   = -0.5;
    } else {
        bounce = value - 0.5;
        move   =  0.5;
    }

    $.each(bouncesComands, function(k, comand) {
        if (comand === '-bounce-')
            script += 'G0 ' + axis + bounce.toFixed(2) + ' F500\nG0 ' + axis + move.toFixed(2) + ' F500\n';
        else
            script += comand + '\n';
    });
    return encodeURIComponent(script);
}

// Macro management
function getStoredMacros() {
    const offsetMacros = JSON.parse(localStorage.getItem('offset_macros') || '[]');
    if (Array.isArray(offsetMacros) && offsetMacros.length) return offsetMacros;
    const legacyMacros = JSON.parse(localStorage.getItem('axiscope_macros') || '[]');
    if (Array.isArray(legacyMacros) && legacyMacros.length) {
        localStorage.setItem('offset_macros', JSON.stringify(legacyMacros));
        localStorage.removeItem('axiscope_macros');
        return legacyMacros;
    }
    return [];
}

function saveMacro() {
    const name    = $('#macro-name').val().trim();
    const command = $('#macro-command').val().trim();
    if (!name || !command) { console.log('Both name and command are required'); return; }
    let macros = JSON.parse(localStorage.getItem('offset_macros') || '[]');
    macros.push({ name, command });
    localStorage.setItem('offset_macros', JSON.stringify(macros));
    $('#macro-name').val('');
    $('#macro-command').val('');
    loadMacros();
}

function loadMacros() {
    const macros     = JSON.parse(localStorage.getItem('offset_macros') || '[]');
    const $macroList = $('#macro-list');
    $macroList.empty();
    macros.forEach((macro, index) => {
        const $item = $(`
            <div class="list-group-item d-flex justify-content-between align-items-center">
                <button type="button" class="btn btn-sm btn-secondary flex-grow-1 me-2" onclick="executeMacro(${index})">${macro.name}</button>
                <button type="button" class="btn btn-sm btn-danger" onclick="deleteMacro(${index})"><i class="bi bi-trash"></i></button>
            </div>`);
        $macroList.append($item);
    });
}

function executeMacro(index) {
    const macros = JSON.parse(localStorage.getItem('offset_macros') || '[]');
    const macro  = macros[index];
    if (!macro) return;
    $.get(printerUrl(printerIp, `/printer/gcode/script?script=${encodeURIComponent(macro.command)}`));
}

function deleteMacro(index) {
    let macros = JSON.parse(localStorage.getItem('offset_macros') || '[]');
    macros.splice(index, 1);
    localStorage.setItem('offset_macros', JSON.stringify(macros));
    loadMacros();
}

// ---------------------------------------------------------------------------
// FIX: Extract Save-IP handler as a named function so it can be re-attached
// after disconnect. Previously it was anonymous and permanently removed when
// camera selection called .off('click') — Save IP did nothing on reconnect.
// ---------------------------------------------------------------------------
function handleSaveIp() {
    let ip = $('#printerIp').val().replace(/^https?:\/\//, '');
    if (!isValidIP(ip)) return;

    $('#saveIpBtn').prop('disabled', true)
                  .html('<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Connecting...');

    $.get(printerUrl(ip, "/server/info"), function(con_data) {
        if (con_data['result'] && con_data['result']['klippy_connected']) {
            $('#ipError').removeClass('text-danger').addClass('text-success').text('Connected successfully!').show();
            $('#printerIp').prop('disabled', true);
            $('#disconnectBtn').show();

            $.get(printerUrl(ip, "/server/webcams/list"), function(cam_data) {
                if (cam_data['result'] && cam_data['result']['webcams']) {
                    const cams = cam_data['result']['webcams'];
                    if (cams.length > 0) {
                        const $cameraList = $('#cameraList');
                        $cameraList.empty();
                        cams.forEach(function(cam) {
                            const streamUrl   = printerUrl(ip, cam.stream_url);
                            const snapshotUrl = streamUrl.replace('?action=stream', '?action=snapshot');
                            $cameraList.append(`
                                <div class="camera-option p-2"
                                     data-url="${streamUrl}"
                                     data-flip-h="${cam.flip_horizontal}"
                                     data-flip-v="${cam.flip_vertical}">
                                    <div class="d-flex align-items-center">
                                        <div class="me-3">
                                            <img src="${snapshotUrl}" class="camera-preview" alt="${cam.name}">
                                        </div>
                                        <div>
                                            <h6 class="mb-0">${cam.name}</h6>
                                            <small class="text-muted">Click to select</small>
                                        </div>
                                    </div>
                                </div>`);
                        });
                        $('#camera-select').show();
                        $('#saveIpBtn').html('Select Camera').prop('disabled', false)
                                      .removeClass('btn-primary').addClass('btn-success');
                    } else {
                        $('#ipError').removeClass('text-success').addClass('text-danger')
                                   .text('No cameras found on this printer').show();
                    }
                } else {
                    $('#ipError').removeClass('text-success').addClass('text-danger')
                               .text('Error fetching camera list').show();
                }
            }).fail(function() {
                $('#ipError').removeClass('text-success').addClass('text-danger')
                           .text('Could not fetch camera list from printer').show();
            });
        } else {
            $('#ipError').show().text('Printer is not ready. Please check if Klippy is connected.');
            $('#saveIpBtn').prop('disabled', false).text('Retry Connection');
        }
    }).fail(function() {
        $('#ipError').show().text('Could not connect to printer. Please check the IP address and ensure the printer is online.');
        $('#saveIpBtn').prop('disabled', false).text('Retry Connection');
    });
}

$(document).ready(function() {
    $("#ChangePrinter").click(function(){ $('#printerModal').modal('show'); });
    $('#printerModal').modal('show');

    $('#printerIp').on('input', function() {
        const ip = $(this).val();
        if (ip && !isValidIP(ip)) {
            $('#ipError').show();
            $('#saveIpBtn').prop('disabled', true);
        } else {
            $('#ipError').hide();
            $('#saveIpBtn').prop('disabled', false);
        }
    });

    loadMacros();
    $('#save-macro').on('click', saveMacro);
    $('#macro-command').on('keypress', function(e) { if (e.which === 13) saveMacro(); });

    // Attach named handler (survives disconnect/reconnect)
    $('#saveIpBtn').on('click', handleSaveIp);

    // Camera selection click handler
    $(document).on('click', '.camera-option', function() {
        const selectedUrl = $(this).data('url');
        const flipH       = $(this).data('flip-h');
        const flipV       = $(this).data('flip-v');
        if (!selectedUrl) return;

        $('.camera-option').removeClass('selected');
        $(this).addClass('selected');

        $('#saveIpBtn')
            .html('Connect to Camera')
            .prop('disabled', false)
            .removeClass('btn-success').addClass('btn-primary')
            .off('click')
            .on('click', function() { connectCamera(selectedUrl, flipH, flipV); });
    });

    // Disconnect handler
    $('#disconnectBtn').on('click', function() {
        if (updateInterval) { clearInterval(updateInterval); updateInterval = null; }

        // FIX: stop probe polling so it doesn't keep hitting old printer
        if (typeof stopProbeResultsUpdates === 'function') stopProbeResultsUpdates();

        printerIp  = '';
        WebcamPath = '/webcam?action=stream';

        // FIX: clear IP input so user can type a new address
        $('#printerIp').prop('disabled', false).val('');
        $(this).hide();
        $('#camera-select').hide();
        $('#camContainer').hide();

        // FIX: re-attach named handler after .off('click') from camera selection
        $('#saveIpBtn').html('Save IP')
                       .prop('disabled', false)
                       .removeClass('btn-success')
                       .addClass('btn-primary')
                       .off('click')
                       .on('click', handleSaveIp);

        $('#ipError').hide().removeClass('text-success').addClass('text-danger')
                    .text('Invalid IP address format');
        $('#cameraList').empty();
        $('#BouncePositionBar, #BigPositionBar').empty();
    });
});

// Camera connection — called when user confirms camera selection
function connectCamera(selectedUrl, flipHorizontal, flipVertical) {
    if (updateInterval) { clearInterval(updateInterval); updateInterval = null; }

    const selectedIp = $('#printerIp').val().replace(/^https?:\/\//, '');

    // FIX: use URL API for reliable path extraction instead of fragile string split
    let webcamPath;
    try {
        const urlObj = new URL(selectedUrl);
        webcamPath   = urlObj.pathname + urlObj.search;
    } catch (e) {
        webcamPath = selectedUrl.split(selectedIp)[1] || '/webcam?action=stream';
    }

    printerIp  = selectedIp;
    WebcamPath = webcamPath;

    isFlippedHorizontal = false;
    isFlippedVertical   = false;
    $('#flip-horizontal, #flip-vertical').removeClass('btn-primary').addClass('btn-secondary');

    $("#zoom-image").attr("src", printerUrl(printerIp, WebcamPath));

    if (flipHorizontal) { $('#flip-horizontal').removeClass('btn-secondary').addClass('btn-primary'); isFlippedHorizontal = true; }
    if (flipVertical)   { $('#flip-vertical').removeClass('btn-secondary').addClass('btn-primary');   isFlippedVertical   = true; }
    updateTransform();

    $("#home-all")
        .attr("data-url", printerUrl(printerIp, '/printer/gcode/script?script=G28'))
        .attr("data-homed", "false").addClass("btn-danger").removeClass("btn-primary");
    $("#qgl")
        .attr("data-url", printerUrl(printerIp, '/printer/gcode/script?script=QUAD_GANTRY_LEVEL'))
        .attr("data-qgl", "false").addClass("btn-danger").removeClass("btn-primary");
    $("#disable-motors")
        .attr("data-url", printerUrl(printerIp, '/printer/gcode/script?script=M84'))
        .attr("data-motoron", "false").addClass("btn-danger").removeClass("btn-primary");

    $('#camContainer').fadeIn();
    $('#printerModal').modal('hide');
    $('#BouncePositionBar, #BigPositionBar').empty();
    initializePositionBars();
    updatePage();
    getTools();
    updateInterval = setInterval(updatePage, 1000);
}

// Initialize position bars
function initializePositionBars() {
    const bounceMove = (axis, value) =>
        printerUrl(printerIp, '/printer/gcode/script?script=' + ComandsUrl(axis, value));

    $('#BouncePositionBar, #BigPositionBar').empty();

    // Fine bar (X and Y) — IDs: home-fine-x, home-fine-y
    const $container = $("#BouncePositionBar");
    ["X", "Y"].forEach(axis => {
        const $row = $('<div class="row pb-1"></div>');
        const $bg  = $('<div class="btn-group btn-group-sm ps-5 pe-5" role="group"></div>');

        [-0.5, -0.1, -0.05, -0.01].forEach(v => {
            $('<button>', { type:"button", class:"btn btn-secondary border",
                "data-url": bounceMove(axis, v), text: v.toFixed(2) }).appendTo($bg);
        });
        $('<button>', { type:"button", class:"btn btn-dark border border-dark",
            "data-url": printerUrl(printerIp, `/printer/gcode/script?script=${encodeURIComponent('G28 ' + axis)}`),
            id: `home-fine-${axis.toLowerCase()}`, text: axis }).appendTo($bg);
        [0.01, 0.05, 0.1, 0.5].forEach(v => {
            $('<button>', { type:"button", class:"btn btn-secondary border",
                "data-url": bounceMove(axis, v), text: `+${v.toFixed(2)}` }).appendTo($bg);
        });

        $('<div class="btn-toolbar justify-content-center" role="toolbar"></div>').append($bg).appendTo($row);
        $container.append($row);
    });

    // FIX: Coarse bar (X, Y, Z) — IDs: home-course-x, home-course-y, home-course-z
    // Previously also used home-fine-* causing duplicate IDs.
    // updateHoming() already referenced home-course-* so the buttons were never highlighted.
    const $containerBig = $("#BigPositionBar");
    ["X", "Y", "Z"].forEach(axis => {
        const $row = $('<div class="row pb-1"></div>');
        const $bg  = $('<div class="btn-group btn-group-sm ps-5 pe-5" role="group"></div>');

        const negVals = axis !== "Z" ? [-50, -10, -5, -1]   : [-25, -10, -1, -0.1];
        const posVals = axis !== "Z" ? [1, 5, 10, 50]        : [0.1, 1, 10, 25];

        negVals.forEach(v => {
            $('<button>', { type:"button", class:"btn btn-secondary border",
                "data-url": bounceMove(axis, v), text: v.toFixed(2) }).appendTo($bg);
        });
        $('<button>', { type:"button", class:"btn btn-dark border border-dark",
            "data-url": printerUrl(printerIp, `/printer/gcode/script?script=${encodeURIComponent('G28 ' + axis)}`),
            id: `home-course-${axis.toLowerCase()}`, text: axis }).appendTo($bg);
        posVals.forEach(v => {
            $('<button>', { type:"button", class:"btn btn-secondary border",
                "data-url": bounceMove(axis, v), text: `+${v.toFixed(2)}` }).appendTo($bg);
        });

        $('<div class="btn-toolbar justify-content-center" role="toolbar"></div>').append($bg).appendTo($row);
        $containerBig.append($row);
    });
}

// Button click handlers
$(document).on("click", "button", function() {
    if ($(this).data("url")) {
        $.get($(this).data("url"));
    } else if ($(this).data("axis")) {
        const tool     = $(this).data("tool");
        const axis     = String($(this).data("axis")).toLowerCase();
        const position = parseFloat($("#pos-" + axis).text());
        if (!Number.isNaN(position)) $("input[name=T" + tool + "-" + axis + "-pos]").val(position.toFixed(3));
        updateOffset(tool, axis);
    } else if ($(this).is("#capture-pos")) {
        $("#captured-x").find(">:first-child").text(parseFloat($("#pos-x").text()).toFixed(3));
        $("#captured-y").find(">:first-child").text(parseFloat($("#pos-y").text()).toFixed(3));
        $("#captured-z").find(">:first-child").text(parseFloat($("#pos-z").text()).toFixed(3));
    } else if ($(this).is("#toolchange")) {
        $.get(toolChangeURL($(this).data("tool")));
    }
});

$(document).on("change", "input[type=number]", function() {
    updateOffset($(this).data("tool"), $(this).data("axis"));
});
