// Mouse easter egg: click polling dot -> show 🐭 briefly
(function () {
  // ── CONFIG ────────────────────────────────────
  var MOUSE_EMOJI = "🐭";
  var SHOW_MS = 2000;
  var REMOVE_AFTER_HIDE_MS = 180;
  var TRANSITION_MS = 120;
  var MAX_FONT_PX = 300;
  var VIEWPORT_FONT_VW = 28;
  var SCALE_FROM = 0.9;
  var SCALE_TO = 1;
  var Z_INDEX = 99999;
  var DROP_SHADOW = "0 10px 30px rgba(0,0,0,.45)";

  function ensureStyles() {
    if (document.getElementById("mouseEastereggStyles")) return;
    var style = document.createElement("style");
    style.id = "mouseEastereggStyles";
    style.textContent =
      "#mouseEasteregg{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%) scale(" + SCALE_FROM + ");" +
      "font-size:min(" + MAX_FONT_PX + "px," + VIEWPORT_FONT_VW + "vw);line-height:1;z-index:" + Z_INDEX + ";pointer-events:none;" +
      "filter:drop-shadow(" + DROP_SHADOW + ");opacity:0;" +
      "transition:opacity " + (TRANSITION_MS / 1000) + "s ease,transform " + (TRANSITION_MS / 1000) + "s ease}" +
      "#mouseEasteregg.show{opacity:1;transform:translate(-50%,-50%) scale(" + SCALE_TO + ")}" +
      "@media (prefers-reduced-motion: reduce){" +
      "#mouseEasteregg{transition:none}" +
      "}";
    document.head.appendChild(style);
  }

  function showMouseOnce() {
    ensureStyles();
    var existing = document.getElementById("mouseEasteregg");
    if (existing) existing.remove();

    var el = document.createElement("div");
    el.id = "mouseEasteregg";
    el.textContent = MOUSE_EMOJI;
    document.body.appendChild(el);

    // trigger transition
    void el.offsetHeight;
    el.classList.add("show");

    setTimeout(function () {
      el.classList.remove("show");
      setTimeout(function () { el.remove(); }, REMOVE_AFTER_HIDE_MS);
    }, SHOW_MS);
  }

  function bind() {
    var dot = document.getElementById("pollingDot");
    if (!dot) return;
    dot.addEventListener("click", function (e) {
      e.preventDefault();
      showMouseOnce();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();

