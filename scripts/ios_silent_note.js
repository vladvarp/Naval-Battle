/* global document, navigator */
(function () {
  // =========================
  // CONFIG (ручной переключатель)
  // "off"    — выключено
  // "iphone" — только на iPhone
  // "all"    — на всех устройствах
  // =========================
  var MODE = "iphone";

  function isIphoneDevice() {
    var ua = navigator.userAgent || "";
    return /iPhone/.test(ua);
  }

  function shouldShow(mode) {
    if (mode === "off") return false;
    if (mode === "all") return true;
    return isIphoneDevice();
  }

  function apply() {
    var note = document.getElementById("iosSilentNote");
    if (note) note.hidden = !shouldShow(MODE);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", apply);
  } else {
    apply();
  }
})();

