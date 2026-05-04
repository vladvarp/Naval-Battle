(function () {
  var KEY = "navalAudioEngine";
  var ver = "v2";
  try {
    var stored = localStorage.getItem(KEY);
    if (stored === "v1" || stored === "v2") ver = stored;
  } catch (e) {}
  document.write('<script src="./scripts/audio_engine/audio_' + ver + '.js"><\/script>');

  function currentVer() {
    try {
      var s = localStorage.getItem(KEY);
      if (s === "v1" || s === "v2") return s;
    } catch (e) {}
    return "v2";
  }
  var btn = document.getElementById("adminAudioToggle");
  if (btn) {
    btn.textContent = currentVer() === "v1"
      ? "🔉 HTML Audio"
      : "🔉 Web Audio";
    btn.addEventListener("click", function () {
      var next = currentVer() === "v1" ? "v2" : "v1";
      try { localStorage.setItem(KEY, next); } catch (e) {}
      location.reload();
    });
  }
})();
