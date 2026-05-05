// ============================================================
// NAVAL COMBAT — Apps Script Ping Monitor v1.0
// ping_monitor.js — индикатор задержки API (GAS) во время PvP
// ============================================================
;(function () {
  "use strict";

  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  function nowPerf() {
    return (typeof performance !== "undefined" && performance && typeof performance.now === "function")
      ? performance.now()
      : Date.now();
  }

  function isGameScreenVisible() {
    var gs = document.getElementById("gameScreen");
    if (!gs) return false;
    return gs.style.display !== "none";
  }

  function isSoloActive() {
    try { return !!(window.solo && window.solo.active); } catch (e) { return false; }
  }

  function shouldShowInPvp() {
    // Показываем только когда пользователь реально в онлайне (есть roomId/playerId) и не соло.
    // Это работает без правок engine.js, т.к. session кладётся в localStorage.
    try {
      if (!isGameScreenVisible()) return false;
      if (isSoloActive()) return false;
      var pid = null, rid = null;
      try { pid = localStorage.getItem("mb_playerId"); } catch (e) {}
      try { rid = localStorage.getItem("mb_roomId"); } catch (e) {}
      return !!(pid && rid);
    } catch (e) {
      return false;
    }
  }

  function fmtMs(ms) {
    if (ms == null || !isFinite(ms)) return "—";
    if (ms < 1000) return Math.round(ms) + "мс";
    return (ms / 1000).toFixed(ms >= 10000 ? 0 : 1) + "с";
  }

  function fmtTime(ts) {
    try { return new Date(ts).toLocaleTimeString("ru-RU"); } catch (e) { return "—"; }
  }

  function getQuality(rttMs) {
    if (rttMs == null || !isFinite(rttMs)) return { key: "na", label: "нет данных", color: "rgba(168,228,255,0.55)" };
    if (rttMs <= 4000) return { key: "great", label: "отлично", color: "#7dffb3" };
    if (rttMs <= 8000) return { key: "ok", label: "норм", color: "#f0c040" };
    if (rttMs <= 15000) return { key: "bad", label: "плохо", color: "#ff9900" };
    return { key: "awful", label: "очень плохо", color: "#ff6b6b" };
  }

  var pingMonitor = {
    active: false,
    samples: [],
    maxSamples: 6,
    inFlight: null, // { id, sentAt, t0Perf, url }
    _tickTimer: null,
    warn: {
      el: null,
      lastShownAt: 0,
      hideTimer: null
    },
    last: {
      sentAt: null,
      receivedAt: null,
      rttMs: null,
      ok: null,
      error: null
    },
    el: null,
    elText: null,
    elDot: null,
    elTip: null,

    ensureDom: function () {
      if (this.el && document.body.contains(this.el)) return;

      var root = document.getElementById("pingIndicator");
      if (!root) {
        root = document.createElement("div");
        root.id = "pingIndicator";
        root.className = "ping-indicator";
        document.body.appendChild(root);
      }

      if (!root.querySelector(".ping-dot")) {
        root.innerHTML =
          '<div class="ping-head">' +
            '<div class="ping-dot"></div>' +
            '<div class="ping-text"></div>' +
          '</div>' +
          '<div class="ping-tip" role="status" aria-live="polite"></div>';
      }

      this.el = root;
      this.elDot = root.querySelector(".ping-dot");
      this.elText = root.querySelector(".ping-text");
      this.elTip = root.querySelector(".ping-tip");

      // Предупреждение вверху/центр (создаём один раз)
      if (!this.warn.el || !document.body.contains(this.warn.el)) {
        var w = document.getElementById("pingWarn");
        if (!w) {
          w = document.createElement("div");
          w.id = "pingWarn";
          w.className = "ping-warn";
          w.innerHTML = '<div class="ping-warn-dot"></div><div class="ping-warn-text"></div>';
          document.body.appendChild(w);
        }
        this.warn.el = w;
      }
    },

    start: function () {
      this.active = true;
      this.ensureDom();
      this.el.style.display = "flex";
      this.startTick();
      this.render();
    },

    stop: function () {
      this.active = false;
      this.ensureDom();
      this.el.style.display = "none";
      this.stopTick();
      this.hideWarning();
    },

    startTick: function () {
      var self = this;
      if (self._tickTimer) return;
      self._tickTimer = setInterval(function () {
        // пока есть inFlight — обновляем UI в процессе ожидания
        if (!self.active) return;
        if (!self.inFlight) return;
        self.render();
      }, 250);
    },

    stopTick: function () {
      if (this._tickTimer) { clearInterval(this._tickTimer); this._tickTimer = null; }
    },

    reset: function () {
      this.samples = [];
      this.inFlight = null;
      this.last.sentAt = null;
      this.last.receivedAt = null;
      this.last.rttMs = null;
      this.last.ok = null;
      this.last.error = null;
      this.render();
    },

    markSent: function (meta) {
      if (!this.active) return;
      this.ensureDom();
      var id = "f_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
      this.inFlight = {
        id: id,
        sentAt: (meta && meta.sentAt) || Date.now(),
        t0Perf: (meta && meta.t0Perf) || nowPerf(),
        url: meta && meta.url ? String(meta.url) : ""
      };
      this.last.sentAt = this.inFlight.sentAt;
      this.last.receivedAt = null;
      this.last.ok = null;
      this.last.error = null;
      this.last.rttMs = null;
      this.render();
      return id;
    },

    markDone: function (flightId, sample) {
      if (!this.active) return;
      if (!flightId) return;
      if (!this.inFlight || this.inFlight.id !== flightId) {
        // если в полёте уже другой запрос — всё равно запишем sample, но UI не трогаем как inFlight
        this.track(sample);
        return;
      }
      this.inFlight = null;
      this.track(sample);
    },

    track: function (sample) {
      if (!this.active) return;
      this.ensureDom();

      var rtt = (sample && isFinite(sample.rttMs)) ? sample.rttMs : null;

      this.last.sentAt = sample && sample.sentAt != null ? sample.sentAt : Date.now();
      this.last.receivedAt = sample && sample.receivedAt != null ? sample.receivedAt : Date.now();
      this.last.rttMs = rtt;
      this.last.ok = !!(sample && sample.ok);
      this.last.error = sample && sample.error ? String(sample.error) : null;

      if (rtt != null) {
        this.samples.unshift(rtt);
        if (this.samples.length > this.maxSamples) this.samples.pop();
      }

      this.render();
    },

    getAvgRtt: function () {
      if (!this.samples.length) return null;
      var sum = 0;
      for (var i = 0; i < this.samples.length; i++) sum += this.samples[i];
      return sum / this.samples.length;
    },

    showWarning: function (text, minIntervalMs, visibleMs) {
      try {
        if (!this.active) return;
        this.ensureDom();
        if (!this.warn.el) return;

        var now = Date.now();
        var minI = (minIntervalMs == null) ? 3000 : Math.max(0, minIntervalMs);
        if (now - (this.warn.lastShownAt || 0) < minI) return;
        this.warn.lastShownAt = now;

        var textEl = this.warn.el.querySelector(".ping-warn-text");
        if (textEl) textEl.textContent = text;
        this.warn.el.classList.add("show");

        if (this.warn.hideTimer) clearTimeout(this.warn.hideTimer);
        var vis = (visibleMs == null) ? 5200 : Math.max(500, visibleMs);
        this.warn.hideTimer = setTimeout(function () {
          try { pingMonitor.hideWarning(); } catch (e) {}
        }, vis);
      } catch (e) {}
    },

    hideWarning: function () {
      try {
        if (this.warn.hideTimer) { clearTimeout(this.warn.hideTimer); this.warn.hideTimer = null; }
        if (this.warn.el) this.warn.el.classList.remove("show");
      } catch (e) {}
    },

    render: function () {
      if (!this.el) return;

      // Если есть inFlight — показываем прогресс ожидания сразу
      var inFlightMs = null;
      if (this.inFlight && this.inFlight.t0Perf != null) {
        try { inFlightMs = Math.max(0, nowPerf() - this.inFlight.t0Perf); } catch (e) { inFlightMs = null; }
      }

      var base = this.getAvgRtt();
      var displayMs = (inFlightMs != null) ? inFlightMs : base;
      var q = getQuality(displayMs);

      var showRtt = (displayMs != null) ? fmtMs(displayMs) : "—";

      this.elDot.style.background = q.color;
      this.elDot.style.boxShadow = "0 0 10px " + q.color + "55";

      var sent = this.last.sentAt ? fmtTime(this.last.sentAt) : "—";
      var recv = this.last.receivedAt ? fmtTime(this.last.receivedAt) : (this.inFlight ? "ожидание..." : "—");

      this.elText.textContent = "GAS";
      this.el.style.borderColor = q.color + "55";

      // 3 строки по запросу: Apps Script / отдача / получение
      if (q.key === "awful") {
        var warnText = "Плохая связь: задержка Apps Script " + (displayMs != null ? fmtMs(displayMs) : "—") + ". Проверьте сеть или перезагрузите страницу.";
        if (displayMs != null && displayMs >= 150000) {
          warnText = "Связь пропала/зависло: Apps Script " + fmtMs(displayMs) + ". Проверьте соединение и перезагрузите страницу.";
        }
        this.showWarning(warnText, 6500, 5200);
      }

      var line1 = "Apps Script: " + (displayMs != null ? (fmtMs(displayMs) + " (" + q.label + ")") : "нет данных");
      this.elTip.textContent = line1 + "\n" + "Отдача: " + sent + "\n" + "Получение: " + recv;
      this.elTip.style.color = q.key === "awful" ? "#ffb3b3" : "rgba(168,228,255,0.6)";
    }
  };

  // Экспорт в глобальную область
  window.pingMonitor = pingMonitor;

  // ── Автономная интеграция: перехват fetch + авто show/hide ──
  (function installFetchInterceptor() {
    if (window.__pingMonitorFetchInstalled) return;
    window.__pingMonitorFetchInstalled = true;

    if (!window.fetch) return;
    var origFetch = window.fetch;

    window.fetch = function (input, init) {
      var url = (typeof input === "string") ? input : (input && input.url ? input.url : String(input));
      var isGas = false;
      try {
        // API_URL объявлен в scripts/client.js (глобально)
        if (typeof API_URL !== "undefined" && API_URL) {
          isGas = (url.indexOf(String(API_URL)) === 0);
        } else {
          isGas = url.indexOf("script.google.com") !== -1;
        }
      } catch (e) {}

      var sentAt = Date.now();
      var t0 = nowPerf();
      var flightId = null;
      if (isGas) {
        try { flightId = pingMonitor.markSent({ sentAt: sentAt, t0Perf: t0, url: url }); } catch (e) {}
      }

      return origFetch.call(window, input, init).then(function (resp) {
        var t1 = nowPerf();
        if (isGas) {
          try {
            pingMonitor.markDone(flightId, { sentAt: sentAt, receivedAt: Date.now(), rttMs: Math.round(t1 - t0), ok: resp && resp.ok });
          } catch (e) {}
        }
        return resp;
      }, function (err) {
        var t1e = nowPerf();
        if (isGas) {
          try {
            pingMonitor.markDone(flightId, { sentAt: sentAt, receivedAt: Date.now(), rttMs: Math.round(t1e - t0), ok: false, error: err });
          } catch (e) {}
        }
        throw err;
      });
    };
  })();

  (function installVisibilityLoop() {
    var lastVisible = null;
    function tick() {
      var want = shouldShowInPvp();
      if (want !== lastVisible) {
        lastVisible = want;
        try { if (want) pingMonitor.start(); else pingMonitor.stop(); } catch (e) {}
      }
    }
    tick();
    setInterval(tick, 400);
  })();
})();

