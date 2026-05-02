// ============================================================
// NAVAL COMBAT — Монитор системы (Админ-панель)
// admin_monitor.js — v1.0
// ============================================================

var _monitorInterval = null;
var _monitorStartTime = Date.now();

// ── УТИЛИТЫ ──────────────────────────────────────────────────

function fmtBytes(bytes) {
  if (bytes == null || isNaN(bytes)) return "—";
  if (bytes < 1024) return bytes + " Б";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " КБ";
  return (bytes / (1024 * 1024)).toFixed(2) + " МБ";
}

function fmtMs(ms) {
  if (ms == null || isNaN(ms)) return "—";
  if (ms < 1000) return Math.round(ms) + " мс";
  return (ms / 1000).toFixed(1) + " с";
}

function fmtDuration(ms) {
  var s = Math.floor(ms / 1000);
  var m = Math.floor(s / 60);
  var h = Math.floor(m / 60);
  s %= 60; m %= 60;
  if (h > 0) return h + "ч " + m + "м " + s + "с";
  if (m > 0) return m + "м " + s + "с";
  return s + "с";
}

function escHtml(str) {
  return String(str || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

// ── СБОР ДАННЫХ ───────────────────────────────────────────────

async function collectMonitorData() {
  var data = {};

  // ── 1. ПРОИЗВОДИТЕЛЬНОСТЬ БРАУЗЕРА ──
  data.perf = {};
  try {
    if (window.performance && performance.memory) {
      data.perf.heapUsed   = performance.memory.usedJSHeapSize;
      data.perf.heapTotal  = performance.memory.totalJSHeapSize;
      data.perf.heapLimit  = performance.memory.jsHeapSizeLimit;
    }
    if (window.performance && performance.now) {
      data.perf.uptime = performance.now();
    }
    if (window.performance && performance.timing) {
      var t = performance.timing;
      data.perf.pageLoad = t.loadEventEnd - t.navigationStart;
      data.perf.domReady = t.domContentLoadedEventEnd - t.navigationStart;
    }
  } catch(e) {}

  // ── 2. СЕТЬ ──
  data.net = {};
  try {
    var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn) {
      data.net.effectiveType = conn.effectiveType || "—";
      data.net.downlink      = conn.downlink != null ? conn.downlink + " Мбит/с" : "—";
      data.net.rtt           = conn.rtt != null ? conn.rtt + " мс" : "—";
      data.net.saveData      = conn.saveData ? "ВКЛ" : "ВЫКЛ";
    }
  } catch(e) {}

  // ── 3. АУДИО: IN-MEMORY КЭШИ ──
  data.audio = {};
  try {
    var keys = Object.keys(audioState.cache || {});
    var activeKeys = [];
    var idleKeys = [];
    var totalEstimated = 0;

    keys.forEach(function(src) {
      var a = audioState.cache[src];
      var isActive = a && !a.paused && !a.ended;
      var est = 0;
      try {
        if (a && a.duration && !isNaN(a.duration)) {
          // ~128kbps MP3 → 16 KB/s
          est = Math.round(a.duration * 16 * 1024);
        }
      } catch(e) {}
      totalEstimated += est;
      if (isActive) activeKeys.push({ src: src, est: est, a: a });
      else idleKeys.push({ src: src, est: est, a: a });
    });

    data.audio.totalCached   = keys.length;
    data.audio.activeCount   = activeKeys.length;
    data.audio.idleCount     = idleKeys.length;
    data.audio.estimatedMem  = totalEstimated;
    data.audio.queueLen      = (audioState.queue || []).length;
    data.audio.queuePlaying  = !!audioState.queuePlaying;
    data.audio.enabled       = !!audioState.enabled;
    data.audio.unlocked      = !!audioState.unlocked;
    data.audio.volume        = Math.round((audioState.volume || 0) * 100) + "%";
    data.audio.activeList    = activeKeys;
    data.audio.idleList      = idleKeys;
  } catch(e) {}

  // ── 4. CACHE STORAGE (Service Worker) ──
  data.swCache = { supported: false, entries: [], totalSize: 0, totalCount: 0 };
  try {
    if ('caches' in window) {
      data.swCache.supported = true;
      var cacheNames = await caches.keys();
      data.swCache.cacheNames = cacheNames;
      var allEntries = [];
      var totalSize = 0;
      for (var ci = 0; ci < cacheNames.length; ci++) {
        var cache = await caches.open(cacheNames[ci]);
        var requests = await cache.keys();
        for (var ri = 0; ri < requests.length; ri++) {
          var req = requests[ri];
          var url = req.url;
          var shortName = url.split("/").pop() || url;
          var folder = url.includes("/audio/") ? url.split("/audio/")[1].split("/")[0] : "—";
          var size = null;
          try {
            var resp = await cache.match(req);
            if (resp) {
              var cl = resp.headers.get("content-length");
              if (cl) { size = parseInt(cl); totalSize += size; }
            }
          } catch(e2) {}
          allEntries.push({ url: url, name: shortName, folder: folder, size: size, cacheName: cacheNames[ci] });
        }
      }
      data.swCache.entries    = allEntries;
      data.swCache.totalSize  = totalSize;
      data.swCache.totalCount = allEntries.length;

      // группируем по категориям аудио
      var byCat = {};
      allEntries.forEach(function(e) {
        var cat = e.folder || "прочее";
        if (!byCat[cat]) byCat[cat] = { count: 0, size: 0 };
        byCat[cat].count++;
        if (e.size) byCat[cat].size += e.size;
      });
      data.swCache.byCategory = byCat;
    }
  } catch(e) {
    data.swCache.error = e.message || String(e);
  }

  // ── 5. СОСТОЯНИЕ ИГРЫ ──
  data.game = {};
  try {
    data.game.roomId   = (typeof state !== "undefined" && state.roomId) || "—";
    data.game.playerId = (typeof state !== "undefined" && state.playerId) || "—";
    data.game.mySlot   = (typeof state !== "undefined" && state.mySlot) || "—";
    data.game.nickname = (typeof state !== "undefined" && state.nickname) || "—";
    data.game.locked   = (typeof state !== "undefined" && state.inputLocked) ? "ДА" : "НЕТ";
    data.game.view     = (typeof state !== "undefined" && state.currentView) || "—";
    data.game.pollActive = (typeof state !== "undefined" && !!state.pollTimer) ? "ДА" : "НЕТ";
    data.game.soloActive = (typeof solo !== "undefined" && solo.active) ? "ДА" : "НЕТ";
    data.game.soloPhase  = (typeof solo !== "undefined" && solo.active) ? (solo.phase || "—") : "—";
    data.game.soloTurn   = (typeof solo !== "undefined" && solo.active) ? (solo.turn || "—") : "—";
  } catch(e) {}

  // ── 6. PRELOAD ПРОГРЕСС ──
  data.preload = {};
  try {
    if (audioState.preload) {
      data.preload.started  = audioState.preload.started;
      data.preload.done     = audioState.preload.done;
      data.preload.total    = audioState.preload.total || 0;
      data.preload.finished = audioState.preload.finished || 0;
      data.preload.phase    = audioState.preload.phase || "—";
      data.preload.current  = audioState.preload.currentSrc || "—";
      data.preload.pct      = data.preload.total > 0
        ? Math.round(data.preload.finished / data.preload.total * 100)
        : (data.preload.done ? 100 : 0);
    }
  } catch(e) {}

  // ── 7. localStorage ИСПОЛЬЗОВАНИЕ ──
  data.ls = {};
  try {
    var lsSize = 0;
    var lsKeys = [];
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      var val = localStorage.getItem(key);
      var sz = (key.length + (val ? val.length : 0)) * 2;
      lsSize += sz;
      if (key.startsWith("mb_")) lsKeys.push({ key: key, size: sz });
    }
    data.ls.totalSize  = lsSize;
    data.ls.totalKeys  = localStorage.length;
    data.ls.mbKeys     = lsKeys;
  } catch(e) {}

  return data;
}

// ── РЕНДЕР ────────────────────────────────────────────────────

function renderMonitorSection(title, rows, opts) {
  opts = opts || {};
  var html = '<div class="mon-section">';
  html += '<div class="mon-section-title">' + escHtml(title) + '</div>';
  if (opts.subtitle) html += '<div class="mon-subtitle">' + escHtml(opts.subtitle) + '</div>';
  html += '<table class="mon-table">';
  rows.forEach(function(row) {
    if (!row) return;
    var cls = row.cls ? ' class="' + row.cls + '"' : '';
    var valCls = row.valCls ? ' class="' + row.valCls + '"' : '';
    html += '<tr' + cls + '><td class="mon-key">' + escHtml(row.k) + '</td>';
    html += '<td class="mon-val"' + valCls + '>' + (row.vRaw || escHtml(String(row.v != null ? row.v : "—"))) + '</td></tr>';
  });
  html += '</table>';
  html += '</div>';
  return html;
}

function barHtml(pct, cls) {
  cls = cls || "mon-bar-fill";
  return '<div class="mon-bar-wrap"><div class="' + cls + '" style="width:' + Math.min(100, Math.max(0, pct)) + '%"></div></div>';
}

async function renderMonitor() {
  var container = document.getElementById("monitorBody");
  if (!container) return;

  var d;
  try { d = await collectMonitorData(); }
  catch(e) { container.innerHTML = '<div class="mon-error">Ошибка сбора данных: ' + escHtml(String(e)) + '</div>'; return; }

  var html = "";

  // ── СТАТУС СЕССИИ ──
  html += renderMonitorSection("🎮 СОСТОЯНИЕ СЕССИИ", [
    { k: "Комната",         v: d.game.roomId },
    { k: "Никнейм",         v: d.game.nickname },
    { k: "Слот",            v: d.game.mySlot },
    { k: "Ввод заблокирован", v: d.game.locked, valCls: d.game.locked === "ДА" ? "mon-red" : "mon-green" },
    { k: "Polling активен", v: d.game.pollActive, valCls: d.game.pollActive === "ДА" ? "mon-green" : "" },
    { k: "Режим Solo",      v: d.game.soloActive, valCls: d.game.soloActive === "ДА" ? "mon-gold" : "" },
    d.game.soloActive === "ДА" ? { k: "Solo фаза/ход", v: d.game.soloPhase + " / " + d.game.soloTurn } : null,
    { k: "Вид (поле)",      v: d.game.view },
    { k: "Сессия открыта",  v: fmtDuration(Date.now() - _monitorStartTime) },
  ]);

  // ── АУДИО: IN-MEMORY ──
  var audioPct = d.audio.totalCached > 0 ? Math.round(d.audio.activeCount / d.audio.totalCached * 100) : 0;
  html += renderMonitorSection("🔊 АУДИО — ОПЕРАТИВНАЯ ПАМЯТЬ", [
    { k: "Статус",        v: d.audio.enabled ? "ВКЛ" : "ВЫКЛ", valCls: d.audio.enabled ? "mon-green" : "mon-red" },
    { k: "Разблокирован", v: d.audio.unlocked ? "ДА" : "НЕТ", valCls: d.audio.unlocked ? "mon-green" : "" },
    { k: "Громкость",     v: d.audio.volume },
    { k: "В памяти всего",v: d.audio.totalCached + " объектов" },
    { k: "Активных",      v: d.audio.activeCount,  valCls: d.audio.activeCount > 0 ? "mon-gold" : "" },
    { k: "Простаивает",   v: d.audio.idleCount },
    { k: "Оценка памяти", v: fmtBytes(d.audio.estimatedMem),
      vRaw: '<span class="' + (d.audio.estimatedMem > 5*1024*1024 ? "mon-red" : "mon-green") + '">' + fmtBytes(d.audio.estimatedMem) + '</span>' },
    { k: "Очередь",       v: d.audio.queueLen + (d.audio.queuePlaying ? " (играет)" : " (ожидает)"), valCls: d.audio.queueLen > 0 ? "mon-gold" : "" },
  ]);

  // ── PRELOAD ПРОГРЕСС ──
  if (d.preload && (d.preload.started || d.preload.done)) {
    var pld = d.preload;
    var pldBarCls = pld.done ? "mon-bar-fill-green" : "mon-bar-fill-gold";
    html += renderMonitorSection("⬇ ПРЕДЗАГРУЗКА АУДИО", [
      { k: "Статус",    v: pld.done ? "ЗАВЕРШЕНО" : (pld.started ? "ЗАГРУЗКА..." : "ОЖИДАНИЕ"),
        valCls: pld.done ? "mon-green" : "mon-gold" },
      { k: "Прогресс", v: pld.finished + "/" + pld.total + " (" + pld.pct + "%)",
        vRaw: '<span>' + pld.finished + "/" + pld.total + " (" + pld.pct + "%)</span>" + barHtml(pld.pct, pldBarCls) },
      !pld.done ? { k: "Фаза", v: pld.phase } : null,
      !pld.done ? { k: "Сейчас", v: pld.current.split("/").pop() } : null,
    ]);
  }

  // ── CACHE STORAGE ──
  if (d.swCache.supported) {
    var sw = d.swCache;
    var catRows = [];
    if (sw.byCategory) {
      var cats = Object.keys(sw.byCategory).sort();
      cats.forEach(function(cat) {
        var info = sw.byCategory[cat];
        // сколько файлов ожидается в этой категории
        var expected = 0;
        for (var ei = 0; ei < AUDIO_EVENTS.length; ei++) {
          if (AUDIO_EVENTS[ei].folder && AUDIO_EVENTS[ei].folder.split("/").pop() === cat) {
            expected = AUDIO_EVENTS[ei].files ? AUDIO_EVENTS[ei].files.length : 0;
          }
        }
        var pct2 = expected > 0 ? Math.round(info.count / expected * 100) : 100;
        var barCl = pct2 === 100 ? "mon-bar-fill-green" : pct2 > 0 ? "mon-bar-fill-gold" : "mon-bar-fill-red";
        catRows.push({
          k: cat,
          vRaw: '<span class="mon-val-group">'
            + barHtml(pct2, barCl)
            + ' <span class="' + (pct2 === 100 ? "mon-green" : "mon-gold") + '">' + info.count + (expected ? "/" + expected : "") + '</span>'
            + (info.size ? ' <span class="mon-dim">' + fmtBytes(info.size) + '</span>' : '')
            + '</span>'
        });
      });
    }

    html += renderMonitorSection("📦 CACHE STORAGE (Service Worker)", [
      { k: "Файлов в кэше",    v: sw.totalCount + " шт." },
      { k: "Размер (заголовки)", v: sw.totalSize > 0 ? fmtBytes(sw.totalSize) : "нет данных content-length" },
      { k: "Кэши",             v: (sw.cacheNames || []).join(", ") || "—" },
    ].concat(catRows));
  } else {
    html += renderMonitorSection("📦 CACHE STORAGE", [
      { k: "Статус", v: "Не поддерживается / file://", valCls: "mon-red" }
    ]);
  }

  // ── ПАМЯТЬ БРАУЗЕРА ──
  if (d.perf && d.perf.heapUsed) {
    var heapPct = d.perf.heapLimit > 0 ? Math.round(d.perf.heapUsed / d.perf.heapLimit * 100) : 0;
    html += renderMonitorSection("💾 ПАМЯТЬ БРАУЗЕРА (JS Heap)", [
      { k: "Использовано",   v: fmtBytes(d.perf.heapUsed),
        vRaw: '<span>' + fmtBytes(d.perf.heapUsed) + '</span>' + barHtml(heapPct, heapPct > 80 ? "mon-bar-fill-red" : "mon-bar-fill-green") },
      { k: "Выделено",       v: fmtBytes(d.perf.heapTotal) },
      { k: "Лимит",          v: fmtBytes(d.perf.heapLimit) },
      { k: "Загрузка стр.",  v: fmtMs(d.perf.pageLoad) },
      { k: "DOM готов",      v: fmtMs(d.perf.domReady) },
      { k: "Uptime браузера",v: fmtMs(d.perf.uptime) },
    ]);
  }

  // ── СЕТЬ ──
  if (d.net && d.net.effectiveType) {
    html += renderMonitorSection("🌐 СЕТЬ", [
      { k: "Тип соединения", v: d.net.effectiveType },
      { k: "Скорость",       v: d.net.downlink },
      { k: "RTT",            v: d.net.rtt },
      { k: "Экономия трафика", v: d.net.saveData },
    ]);
  }

  // ── localStorage ──
  if (d.ls && d.ls.totalKeys != null) {
    var lsRows = [
      { k: "Всего ключей",  v: d.ls.totalKeys },
      { k: "Размер данных", v: fmtBytes(d.ls.totalSize) },
    ];
    (d.ls.mbKeys || []).forEach(function(item) {
      lsRows.push({ k: "  " + item.key.replace("mb_",""), v: fmtBytes(item.size), valCls: "mon-dim" });
    });
    html += renderMonitorSection("🗄 LOCAL STORAGE", lsRows);
  }

  // ── АКТИВНЫЕ АУДИО-ОБЪЕКТЫ ──
  if (d.audio && d.audio.activeList && d.audio.activeList.length) {
    var aRows = d.audio.activeList.map(function(item) {
      var name = item.src.split("/").slice(-2).join("/");
      return { k: name, v: fmtBytes(item.est), valCls: "mon-gold" };
    });
    html += renderMonitorSection("▶ ИГРАЮТ СЕЙЧАС", aRows);
  }

  container.innerHTML = html;

  // Метка обновления
  var ts = document.getElementById("monitorTimestamp");
  if (ts) ts.textContent = "обновлено " + new Date().toLocaleTimeString("ru-RU");
}

// ── ОТКРЫТЬ / ЗАКРЫТЬ МОНИТОР ────────────────────────────────

function openMonitor() {
  var overlay = document.getElementById("monitorOverlay");
  if (!overlay) return;
  _monitorStartTime = _monitorStartTime || Date.now();
  overlay.classList.add("show");
  renderMonitor();
  _monitorInterval = setInterval(renderMonitor, 800);
}

function closeMonitor() {
  var overlay = document.getElementById("monitorOverlay");
  if (overlay) overlay.classList.remove("show");
  if (_monitorInterval) { clearInterval(_monitorInterval); _monitorInterval = null; }
}

// ── КОПИРОВАНИЕ ДАННЫХ МОНИТОРА ──────────────────────────────

async function copyMonitorData() {
  var btn = document.getElementById("monitorCopyBtn");

  var d;
  try { d = await collectMonitorData(); } catch(e) { return; }

  var lines = [];
  var now = new Date().toLocaleString("ru-RU");
  lines.push("═══════════════════════════════════");
  lines.push("  NAVAL COMBAT — МОНИТОР СИСТЕМЫ");
  lines.push("  " + now);
  lines.push("═══════════════════════════════════");
  lines.push("");

  // ── Сессия
  lines.push("── СОСТОЯНИЕ СЕССИИ ──");
  lines.push("Комната:           " + (d.game.roomId || "—"));
  lines.push("Никнейм:           " + (d.game.nickname || "—"));
  lines.push("Слот:              " + (d.game.mySlot || "—"));
  lines.push("Ввод заблокирован: " + (d.game.locked || "—"));
  lines.push("Polling активен:   " + (d.game.pollActive || "—"));
  lines.push("Режим Solo:        " + (d.game.soloActive || "—"));
  if (d.game.soloActive === "ДА") {
    lines.push("Solo фаза/ход:     " + d.game.soloPhase + " / " + d.game.soloTurn);
  }
  lines.push("Вид (поле):        " + (d.game.view || "—"));
  lines.push("Сессия открыта:    " + fmtDuration(Date.now() - (_monitorStartTime || Date.now())));
  lines.push("");

  // ── Аудио RAM
  lines.push("── АУДИО — ОПЕРАТИВНАЯ ПАМЯТЬ ──");
  lines.push("Статус:            " + (d.audio.enabled ? "ВКЛ" : "ВЫКЛ"));
  lines.push("Разблокирован:     " + (d.audio.unlocked ? "ДА" : "НЕТ"));
  lines.push("Громкость:         " + (d.audio.volume || "—"));
  lines.push("В памяти всего:    " + (d.audio.totalCached || 0) + " объектов");
  lines.push("Активных:          " + (d.audio.activeCount || 0));
  lines.push("Простаивает:       " + (d.audio.idleCount || 0));
  lines.push("Оценка памяти:     " + fmtBytes(d.audio.estimatedMem));
  lines.push("Очередь:           " + (d.audio.queueLen || 0) + (d.audio.queuePlaying ? " (играет)" : " (ожидает)"));
  lines.push("");

  // ── Preload
  if (d.preload && (d.preload.started || d.preload.done)) {
    lines.push("── ПРЕДЗАГРУЗКА АУДИО ──");
    lines.push("Статус:    " + (d.preload.done ? "ЗАВЕРШЕНО" : (d.preload.started ? "ЗАГРУЗКА..." : "ОЖИДАНИЕ")));
    lines.push("Прогресс:  " + d.preload.finished + "/" + d.preload.total + " (" + d.preload.pct + "%)");
    if (!d.preload.done) {
      lines.push("Фаза:      " + d.preload.phase);
      lines.push("Сейчас:    " + String(d.preload.current).split("/").pop());
    }
    lines.push("");
  }

  // ── Cache Storage
  lines.push("── CACHE STORAGE (Service Worker) ──");
  if (!d.swCache.supported) {
    lines.push("Статус: Не поддерживается / file://");
  } else {
    lines.push("Файлов в кэше:     " + d.swCache.totalCount + " шт.");
    lines.push("Размер (заголовки):" + (d.swCache.totalSize > 0 ? fmtBytes(d.swCache.totalSize) : " нет данных content-length"));
    lines.push("Кэши:              " + (d.swCache.cacheNames || []).join(", "));
    if (d.swCache.byCategory) {
      var cats = Object.keys(d.swCache.byCategory).sort();
      cats.forEach(function(cat) {
        var info = d.swCache.byCategory[cat];
        var expected = 0;
        for (var ei = 0; ei < AUDIO_EVENTS.length; ei++) {
          if (AUDIO_EVENTS[ei].folder && AUDIO_EVENTS[ei].folder.split("/").pop() === cat) {
            expected = AUDIO_EVENTS[ei].files ? AUDIO_EVENTS[ei].files.length : 0;
          }
        }
        var line = "  " + cat + ": " + info.count + (expected ? "/" + expected : "");
        if (info.size) line += " (" + fmtBytes(info.size) + ")";
        lines.push(line);
      });
    }
  }
  lines.push("");

  // ── Память браузера
  if (d.perf && d.perf.heapUsed) {
    lines.push("── ПАМЯТЬ БРАУЗЕРА (JS Heap) ──");
    lines.push("Использовано:  " + fmtBytes(d.perf.heapUsed));
    lines.push("Выделено:      " + fmtBytes(d.perf.heapTotal));
    lines.push("Лимит:         " + fmtBytes(d.perf.heapLimit));
    lines.push("Загрузка стр.: " + fmtMs(d.perf.pageLoad));
    lines.push("DOM готов:     " + fmtMs(d.perf.domReady));
    lines.push("Uptime:        " + fmtMs(d.perf.uptime));
    lines.push("");
  }

  // ── Сеть
  if (d.net && d.net.effectiveType) {
    lines.push("── СЕТЬ ──");
    lines.push("Тип соединения:    " + d.net.effectiveType);
    lines.push("Скорость:          " + d.net.downlink);
    lines.push("RTT:               " + d.net.rtt);
    lines.push("Экономия трафика:  " + d.net.saveData);
    lines.push("");
  }

  // ── localStorage
  if (d.ls && d.ls.totalKeys != null) {
    lines.push("── LOCAL STORAGE ──");
    lines.push("Всего ключей:  " + d.ls.totalKeys);
    lines.push("Размер данных: " + fmtBytes(d.ls.totalSize));
    (d.ls.mbKeys || []).forEach(function(item) {
      lines.push("  " + item.key + ": " + fmtBytes(item.size));
    });
    lines.push("");
  }

  // ── Активные аудио
  if (d.audio && d.audio.activeList && d.audio.activeList.length) {
    lines.push("── ИГРАЮТ СЕЙЧАС ──");
    d.audio.activeList.forEach(function(item) {
      lines.push("  " + item.src.split("/").slice(-2).join("/") + " (" + fmtBytes(item.est) + ")");
    });
    lines.push("");
  }

  lines.push("═══════════════════════════════════");

  var text = lines.join("\n");

  try {
    await navigator.clipboard.writeText(text);
    _showCopyFeedback(btn, "✓");
  } catch(e) {
    // fallback
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0;top:0;left:0;";
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    try { document.execCommand("copy"); _showCopyFeedback(btn, "✓"); }
    catch(e2) { _showCopyFeedback(btn, "✗"); }
    document.body.removeChild(ta);
  }
}

function _showCopyFeedback(btn, symbol) {
  if (!btn) return;
  var orig = btn.textContent;
  btn.textContent = symbol;
  btn.classList.add(symbol === "✓" ? "copied" : "copy-fail");
  setTimeout(function() {
    btn.textContent = orig;
    btn.classList.remove("copied", "copy-fail");
  }, 1400);
}