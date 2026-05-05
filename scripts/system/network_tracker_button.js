// ============================================================
// NAVAL COMBAT — Network Tracker Quick Button
// network_tracker_button.js — кнопка NET (всегда доступна)
// ============================================================
;(function () {
  "use strict";

  var root = null;

  function isEnabled() {
    try {
      return localStorage.getItem("mb_tracker_widget_enabled") === "1";
    } catch (e) {
      return false;
    }
  }

  function ensureDom() {
    if (root && document.body.contains(root)) return root;
    root = document.getElementById("networkTrackerQuickBtn");
    if (!root) {
      root = document.createElement("button");
      root.id = "networkTrackerQuickBtn";
      root.className = "network-tracker-quick";
      root.type = "button";
      root.title = "Открыть NETWORK TRACKER";
      root.innerHTML = '<span class="network-tracker-quick-dot"></span><span class="network-tracker-quick-text">NET</span>';
      root.addEventListener("click", function () {
        try {
          if (typeof window.openNetworkTracker === "function") window.openNetworkTracker();
        } catch (e) {}
      });
      document.body.appendChild(root);
    }
    return root;
  }

  function render() {
    var el = ensureDom();
    if (!el) return;
    el.style.display = isEnabled() ? "inline-flex" : "none";
    el.style.left = "12px";
  }

  function boot() {
    render();
    window.addEventListener("storage", function (e) {
      if (!e || e.key === "mb_tracker_widget_enabled") render();
    });
    window.addEventListener("mb_tracker_widget_changed", render);
    setInterval(render, 220);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
