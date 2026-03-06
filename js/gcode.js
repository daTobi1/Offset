
function sendGcode() {
  var url = printerUrl(printerIp, "/printer/gcode/script?script=" + $("#gcode-input").val());
  $("#gcode-input").val("");

  $.get(url, function(data){
  });
}

$(document).ready(function() {
  $(document).on("click", "#gcode-send", function(){
    sendGcode();
  });


  $("#gcode-input").bind("enterKey",function(e){
    sendGcode();
  });


  $("#gcode-input").keyup(function(e){
    if(e.key === 'Enter'){
      $(this).trigger("enterKey");
    }
  });
});