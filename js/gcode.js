
function sendGcode() {
  var cmd = $("#gcode-input").val();
  if (!cmd || !cmd.trim()) return;
  var url = printerUrl(printerIp, "/printer/gcode/script?script=" + encodeURIComponent(cmd));
  $("#gcode-input").val("");

  $.get(url)
    .done(function(){
      showToast("GCode sent: " + cmd, "success");
    })
    .fail(function(jqXHR){
      showToast("GCode failed: " + extractErrorMessage(jqXHR), "danger");
    });
}

$(document).ready(function() {
  $(document).on("click", "#gcode-send", function(e){
    sendGcode();
  });

  $("#gcode-input").on("enterKey", function(e){
    sendGcode();
  });

  $("#gcode-input").keyup(function(e){
    if(e.keyCode == 13){
      $(this).trigger("enterKey");
    }
  });
});