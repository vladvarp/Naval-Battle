// ============================================================
// NAVAL COMBAT — Монитор системы (Админ-панель)
// admin_monitor.js — v2.0
// Поддержка обоих аудио-движков:
//   audio.js     → HTMLAudioElement (audioState.cache)
//   audio_ios.js → Web Audio API    (audioEngine + AudioContext)
// ============================================================

var _monitorInterval = null;
var _monitorStartTime = Date.now();
var _pcmDetailsOpen = false;

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

function fmtSec(sec) {
  if (sec == null || isNaN(sec)) return "—";
  if (sec < 60) return sec.toFixed(1) + " с";
  return Math.floor(sec / 60) + "м " + (sec % 60).toFixed(0) + "с";
}

function escHtml(str) {
  return String(str || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

// ── ОПРЕДЕЛЕНИЕ АКТИВНОГО ДВИЖКА ─────────────────────────────
// audio_ios.js объявляет глобальный объект audioEngine (Web Audio API)
// audio.js     использует только audioState.cache  (HTMLAudioElement)

function detectAudioEngine() {
  return (typeof audioEngine !== "undefined" && audioEngine !== null) ? "ios" : "standard";
}

// ── СБОР ДАННЫХ ───────────────────────────────────────────────

async function collectMonitorData() {
  var data = {};
  data.engineType = detectAudioEngine();
  var isIos = data.engineType === "ios";

  // ── 1. ПРОИЗВОДИТЕЛЬНОСТЬ БРАУЗЕРА ──
  data.perf = {};
  try {
    if (window.performance && performance.memory) {
      data.perf.heapUsed  = performance.memory.usedJSHeapSize;
      data.perf.heapTotal = performance.memory.totalJSHeapSize;
      data.perf.heapLimit = performance.memory.jsHeapSizeLimit;
    }
    if (window.performance && performance.now) data.perf.uptime = performance.now();
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
      data.net.downlink = conn.downlink != null ? conn.downlink + " Мбит/с" : "—";
      data.net.rtt      = conn.rtt != null ? conn.rtt + " мс" : "—";
      data.net.saveData = conn.saveData ? "ВКЛ" : "ВЫКЛ";
    }
  } catch(e) {}

  // ── 3. АУДИО ОБЩЕЕ (audioState — есть в обоих движках) ──
  data.audio = {};
  try {
    var as = (typeof audioState !== "undefined") ? audioState : null;
    if (as) {
      data.audio.enabled      = !!as.enabled;
      data.audio.unlocked     = !!as.unlocked;
      data.audio.volume       = Math.round((as.volume || 0) * 100) + "%";
      data.audio.queueLen     = (as.queue || []).length;
      data.audio.queuePlaying = !!as.queuePlaying;
    }
  } catch(e) {}

  // ── 3a. СТАНДАРТНЫЙ ДВИЖОК: HTMLAudioElement кэш ──
  data.audioStd = null;
  if (!isIos) {
    data.audioStd = {};
    try {
      var as2 = (typeof audioState !== "undefined") ? audioState : null;
      if (as2) {
        var keys = Object.keys(as2.cache || {});
        var activeList = [], idleList = [], totalEst = 0;
        keys.forEach(function(src) {
          var a = as2.cache[src];
          var active = a && !a.paused && !a.ended;
          var est = 0;
          try { if (a && a.duration && !isNaN(a.duration)) est = Math.round(a.duration * 16 * 1024); } catch(e) {}
          totalEst += est;
          if (active) activeList.push({ src: src, est: est });
          else idleList.push({ src: src, est: est });
        });
        data.audioStd.totalCached  = keys.length;
        data.audioStd.activeCount  = activeList.length;
        data.audioStd.idleCount    = idleList.length;
        data.audioStd.estimatedMem = totalEst;
        data.audioStd.activeList   = activeList;
        data.audioStd.idleList     = idleList;
      }
    } catch(e) {}
  }

  // ── 3b. iOS ДВИЖОК: Web Audio API (AudioContext + AudioBuffer) ──
  data.audioIos = null;
  if (isIos) {
    data.audioIos = {};
    try {
      var ae = (typeof audioEngine !== "undefined") ? audioEngine : null;
      if (ae) {
        var ctx = ae.context;

        // AudioContext состояние
        data.audioIos.ctxState      = ctx ? ctx.state : "не создан";
        data.audioIos.ctxSampleRate = ctx ? ctx.sampleRate + " Гц" : "—";
        data.audioIos.ctxTime       = ctx ? fmtSec(ctx.currentTime) : "—";
        data.audioIos.ctxLatency    = ctx && ctx.baseLatency != null ? (ctx.baseLatency * 1000).toFixed(1) + " мс" : "—";
        data.audioIos.ctxChannels   = ctx && ctx.destination ? ctx.destination.channelCount : "—";
        data.audioIos.masterGain    = ae.masterGain && ae.masterGain.gain ? ae.masterGain.gain.value.toFixed(3) : "нет";

        // ── ДЕТАЛЬНЫЙ СПИСОК БУФЕРОВ В ПАМЯТИ PCM float32 ──
        var bufKeys = Object.keys(ae.buffers || {});
        var pcmBytes = 0;
        data.audioIos.buffersDetail = [];

        bufKeys.forEach(function(src) {
          var buf = ae.buffers[src];
          if (!buf || !buf.length) return;

          var bytes = buf.length * (buf.numberOfChannels || 1) * 4;
          pcmBytes += bytes;

          var shortName = src.split('/').pop() || src;
          if (shortName.length > 38) shortName = '…' + shortName.slice(-35);

          var category = "unknown";
          if (src.includes("/shoot/"))      category = "shoot";
          else if (src.includes("/hit"))    category = "hit";
          else if (src.includes("/sunk"))   category = "sunk";
          else if (src.includes("/miss"))   category = "miss";
          else if (src.includes("/turn"))   category = "turn";
          else if (src.includes("/game"))   category = "game";

          data.audioIos.buffersDetail.push({
            shortName: shortName,
            category: category,
            duration: buf.duration ? buf.duration.toFixed(2) + "с" : "—",
            channels: buf.numberOfChannels || 1,
            frames: buf.length || 0,
            pcmKB: Math.round(bytes / 1024) + " КБ"
          });
        });

        data.audioIos.buffersDetail.sort(function(a, b) { return b.pcmBytes - a.pcmBytes; });

        data.audioIos.buffersDecoded  = bufKeys.length;
        data.audioIos.buffersPcmBytes = pcmBytes;
        data.audioIos.inflightCount   = Object.keys(ae.inflight || {}).length;
        data.audioIos.activeSources   = ae.activeSources ? ae.activeSources.size : 0;
        data.audioIos.initialized     = !!ae.initialized;
        data.audioIos.pendingInit     = !!ae.pendingInit;
      }
    } catch(e) { data.audioIos.error = String(e); }
  }

  // ── 4. CACHE STORAGE (Service Worker) ──
  data.swCache = { supported: false, totalCount: 0, totalSize: 0 };
  try {
    if ("caches" in window) {
      data.swCache.supported = true;
      var cacheNames = await caches.keys();
      data.swCache.cacheNames = cacheNames;
      var allEntries = [], totalSize = 0;
      for (var ci = 0; ci < cacheNames.length; ci++) {
        var cache = await caches.open(cacheNames[ci]);
        var requests = await cache.keys();
        for (var ri = 0; ri < requests.length; ri++) {
          var req = requests[ri];
          var url = req.url;
          var folder = url.includes("/audio/") ? url.split("/audio/")[1].split("/")[0] : "—";
          var size = null;
          try {
            var resp = await cache.match(req);
            if (resp) { var cl = resp.headers.get("content-length"); if (cl) { size = parseInt(cl); totalSize += size; } }
          } catch(e2) {}
          allEntries.push({ url: url, name: url.split("/").pop() || url, folder: folder, size: size });
        }
      }
      data.swCache.entries    = allEntries;
      data.swCache.totalCount = allEntries.length;
      data.swCache.totalSize  = totalSize;
      var byCat = {};
      allEntries.forEach(function(e) {
        var cat = e.folder || "прочее";
        if (!byCat[cat]) byCat[cat] = { count: 0, size: 0 };
        byCat[cat].count++;
        if (e.size) byCat[cat].size += e.size;
      });
      data.swCache.byCategory = byCat;
    }
  } catch(e) { data.swCache.error = e.message || String(e); }

  // ── 5. СОСТОЯНИЕ ИГРЫ ──
  data.game = {};
  try {
    var st = (typeof state !== "undefined") ? state : null;
    var sl = (typeof solo  !== "undefined") ? solo  : null;
    data.game.roomId     = (st && st.roomId)   || "—";
    data.game.playerId   = (st && st.playerId) || "—";
    data.game.mySlot     = (st && st.mySlot)   || "—";
    data.game.nickname   = (st && st.nickname) || "—";
    data.game.locked     = (st && st.inputLocked) ? "ДА" : "НЕТ";
    data.game.view       = (st && st.currentView) || "—";
    data.game.pollActive = (st && !!st.pollTimer)  ? "ДА" : "НЕТ";
    data.game.soloActive = (sl && sl.active) ? "ДА" : "НЕТ";
    data.game.soloPhase  = (sl && sl.active) ? (sl.phase || "—") : "—";
    data.game.soloTurn   = (sl && sl.active) ? (sl.turn  || "—") : "—";
  } catch(e) {}

  // ── 6. PRELOAD ──
  data.preload = {};
  try {
    var pl = (typeof audioState !== "undefined") ? audioState.preload : null;
    if (pl) {
      data.preload.started  = pl.started;
      data.preload.done     = pl.done;
      data.preload.total    = pl.total    || 0;
      data.preload.finished = pl.finished || 0;
      data.preload.phase    = pl.phase    || "—";
      data.preload.current  = pl.currentSrc || "—";
      data.preload.pct = data.preload.total > 0
        ? Math.round(data.preload.finished / data.preload.total * 100)
        : (data.preload.done ? 100 : 0);
    }
  } catch(e) {}

  // ── 7. localStorage ──
  data.ls = {};
  try {
    var lsSize = 0, lsKeys = [];
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      var val = localStorage.getItem(key);
      var sz = (key.length + (val ? val.length : 0)) * 2;
      lsSize += sz;
      if (key.startsWith("mb_")) lsKeys.push({ key: key, size: sz });
    }
    data.ls.totalSize = lsSize;
    data.ls.totalKeys = localStorage.length;
    data.ls.mbKeys    = lsKeys;
  } catch(e) {}

  return data;
}

// ── РЕНДЕР ────────────────────────────────────────────────────

function renderMonitorSection(title, rows) {
  var html = '<div class="mon-section"><div class="mon-section-title">' + escHtml(title) + '</div><table class="mon-table">';
  rows.forEach(function(row) {
    if (!row) return;
    var vc = row.valCls ? ' class="' + row.valCls + '"' : '';
    html += '<tr><td class="mon-key">' + escHtml(row.k) + '</td>'
          + '<td class="mon-val"' + vc + '>' + (row.vRaw || escHtml(String(row.v != null ? row.v : "—"))) + '</td></tr>';
  });
  return html + '</table></div>';
}

function barHtml(pct, cls) {
  return '<div class="mon-bar-wrap"><div class="' + (cls || "mon-bar-fill") + '" style="width:'
    + Math.min(100, Math.max(0, pct)) + '%"></div></div>';
}

async function renderMonitor() {
  var container = document.getElementById("monitorBody");
  if (!container) return;

  // ── Сохраняем состояние PCM-блока перед перерисовкой ──
  var existingDetails = container.querySelector('.pcm-details') || document.getElementById('pcmDetails');
  if (existingDetails) {
    _pcmDetailsOpen = existingDetails.open;
  }

  var d;
  try { d = await collectMonitorData(); }
  catch(e) { container.innerHTML = '<div class="mon-error">Ошибка: ' + escHtml(String(e)) + '</div>'; return; }

  var isIos = d.engineType === "ios";
  var html  = "";

  // ── ДВИЖОК ──
  html += renderMonitorSection("⚙ АУДИО-ДВИЖОК", [
    { k: "Режим",
      vRaw: isIos
        ? '<span class="mon-badge-ios">📱 Web Audio API</span>'
        : '<span class="mon-badge-std">🖥 HTMLAudioElement</span>' },
    { k: "User-Agent (кратко)", v: (navigator.userAgent || "").substring(0, 58) + "…", valCls: "mon-dim" },
  ]);

  // ── СЕССИЯ ──
  html += renderMonitorSection("🎮 СОСТОЯНИЕ СЕССИИ", [
    { k: "Комната",           v: d.game.roomId },
    { k: "Никнейм",           v: d.game.nickname },
    { k: "Слот",              v: d.game.mySlot },
    { k: "Ввод заблокирован", v: d.game.locked,     valCls: d.game.locked     === "ДА" ? "mon-red"   : "mon-green" },
    { k: "Polling активен",   v: d.game.pollActive,  valCls: d.game.pollActive === "ДА" ? "mon-green" : "" },
    { k: "Solo-режим",        v: d.game.soloActive,  valCls: d.game.soloActive === "ДА" ? "mon-gold"  : "" },
    d.game.soloActive === "ДА" ? { k: "Solo фаза / ход", v: d.game.soloPhase + " / " + d.game.soloTurn } : null,
    { k: "Вид (поле)",        v: d.game.view },
    { k: "Монитор открыт",    v: fmtDuration(Date.now() - _monitorStartTime) },
  ]);

  // ── АУДИО ОБЩЕЕ ──
  html += renderMonitorSection("🔊 АУДИО — ОБЩЕЕ", [
    { k: "Звук",          v: d.audio.enabled  ? "ВКЛ"  : "ВЫКЛ", valCls: d.audio.enabled  ? "mon-green" : "mon-red" },
    { k: "Разблокирован", v: d.audio.unlocked ? "ДА"   : "НЕТ",  valCls: d.audio.unlocked ? "mon-green" : "mon-red" },
    { k: "Громкость",     v: d.audio.volume },
    { k: "Очередь",       v: (d.audio.queueLen || 0) + (d.audio.queuePlaying ? " (воспроизводится)" : " (пусто)"),
      valCls: d.audio.queueLen > 0 ? "mon-gold" : "" },
  ]);

  if (isIos && d.audioIos) {
    // ───────────── iOS: Web Audio API ─────────────
    var ai = d.audioIos;
    if (ai.error) {
      html += renderMonitorSection("🎛 WEB AUDIO API", [{ k: "Ошибка", v: ai.error, valCls: "mon-red" }]);
    } else {
      var ctxCls = ai.ctxState === "running" ? "mon-green" : ai.ctxState === "suspended" ? "mon-gold" : "mon-red";
      html += renderMonitorSection("🎛 WEB AUDIO API — КОНТЕКСТ", [
        { k: "Состояние",        v: ai.ctxState,      valCls: ctxCls },
        { k: "Частота дискр.",   v: ai.ctxSampleRate },
        { k: "Текущее время",    v: ai.ctxTime },
        { k: "Базовая задержка", v: ai.ctxLatency },
        { k: "Каналов вывода",   v: ai.ctxChannels },
        { k: "Master Gain",      v: ai.masterGain },
        { k: "Инициализирован",  v: ai.initialized ? "ДА" : "НЕТ", valCls: ai.initialized ? "mon-green" : "mon-red" },
        { k: "Ожидает жеста",    v: ai.pendingInit  ? "ДА (iOS жест не выполнен)" : "НЕТ",
          valCls: ai.pendingInit ? "mon-gold" : "" },
      ]);

      var pcmCls = ai.buffersPcmBytes > 80*1024*1024 ? "mon-red" : ai.buffersPcmBytes > 30*1024*1024 ? "mon-gold" : "mon-green";
      html += renderMonitorSection("🎵 WEB AUDIO API — БУФЕРЫ В ПАМЯТИ", [
        { k: "Декодировано файлов",
          vRaw: '<span class="' + (ai.buffersDecoded > 0 ? "mon-green" : "") + '">' + ai.buffersDecoded + '</span>' },
        { k: "Память (PCM float32)",
          vRaw: '<span class="' + pcmCls + '">' + fmtBytes(ai.buffersPcmBytes) + '</span>'
            + ' <span class="mon-dim">(реальная, декодированная)</span>' },
        { k: "Загружаются сейчас", v: ai.inflightCount, valCls: ai.inflightCount > 0 ? "mon-gold" : "" },
        { k: "Активных источников (играют)", v: ai.activeSources,
          valCls: ai.activeSources > 0 ? "mon-gold" : "" },
        { k: "Макс. одновременно", v: ai.maxConcurrency },
        { k: "HTMLAudio-объектов (legacy)", v: ai.htmlCacheCount, valCls: "mon-dim" },
      ]);

      // ── ДЕТАЛЬНЫЙ СПИСОК БУФЕРОВ (с сохранением открытого/закрытого состояния) ──
      if (ai.buffersDetail && ai.buffersDetail.length) {
        var openAttr = _pcmDetailsOpen ? ' open' : '';
        html += `<details id="pcmDetails" class="mon-section pcm-details"${openAttr}>`;
        html += `<summary class="mon-section-title">🔬 Что именно занимает память (PCM float32) <span class="mon-dim">(${ai.buffersDetail.length} буферов)</span></summary>`;
        html += '<table class="mon-table" style="font-size:10px;line-height:1.3">';
        html += '<thead><tr><th style="width:45%">Файл</th><th>Кат.</th><th>Длит.</th><th>Кан.</th><th style="text-align:right">Размер</th></tr></thead><tbody>';
        
        ai.buffersDetail.forEach(function(b) {
          html += `<tr>
            <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(b.shortName)}</td>
            <td><span class="mon-dim">${b.category}</span></td>
            <td>${b.duration}</td>
            <td>${b.channels}ch</td>
            <td style="text-align:right" class="mon-gold">${b.pcmKB}</td>
          </tr>`;
        });
        
        html += '</tbody></table></details>';
      }
    }
  } else if (d.audioStd) {
    // ───────────── Стандарт: HTMLAudioElement ─────────────
    var std = d.audioStd;
    var estCls = std.estimatedMem > 5*1024*1024 ? "mon-red" : std.estimatedMem > 2*1024*1024 ? "mon-gold" : "mon-green";
    html += renderMonitorSection("🎵 HTMLAudioElement — КЭШ В ПАМЯТИ", [
      { k: "Объектов в кэше",  v: (std.totalCached || 0) + " шт." },
      { k: "Активных (играют)", v: std.activeCount, valCls: std.activeCount > 0 ? "mon-gold" : "" },
      { k: "Простаивающих",    v: std.idleCount },
      { k: "Оценка памяти (~128kbps)",
        vRaw: '<span class="' + estCls + '">' + fmtBytes(std.estimatedMem) + '</span>'
          + ' <span class="mon-dim">(приблизительно)</span>' },
    ]);

    if (std.activeList && std.activeList.length) {
      html += renderMonitorSection("▶ ИГРАЮТ СЕЙЧАС", std.activeList.map(function(it) {
        return { k: it.src.split("/").slice(-2).join("/"), v: fmtBytes(it.est), valCls: "mon-gold" };
      }));
    }
  }

  // ── PRELOAD ──
  if (d.preload && (d.preload.started || d.preload.done)) {
    var pl = d.preload;
    var plCls = pl.done ? "mon-bar-fill-green" : "mon-bar-fill-gold";
    html += renderMonitorSection("⬇ ПРЕДЗАГРУЗКА АУДИО", [
      { k: "Статус",    v: pl.done ? "ЗАВЕРШЕНО" : (pl.started ? "ЗАГРУЗКА..." : "ОЖИДАНИЕ"),
        valCls: pl.done ? "mon-green" : "mon-gold" },
      { k: "Прогресс",
        vRaw: '<span class="mon-val-group"><span>' + pl.finished + "/" + pl.total + " (" + pl.pct + "%)</span>"
          + barHtml(pl.pct, plCls) + '</span>' },
      !pl.done ? { k: "Фаза",    v: pl.phase } : null,
      !pl.done ? { k: "Сейчас", v: String(pl.current).split("/").pop() } : null,
    ]);
  }

  // ── CACHE STORAGE ──
  var sw = d.swCache;
  var catRows = [];
  if (sw.supported && sw.byCategory) {
    Object.keys(sw.byCategory).sort().forEach(function(cat) {
      var info = sw.byCategory[cat];
      var expected = 0;
      for (var ei = 0; ei < AUDIO_EVENTS.length; ei++) {
        if (AUDIO_EVENTS[ei].folder && AUDIO_EVENTS[ei].folder.split("/").pop() === cat)
          expected = AUDIO_EVENTS[ei].files ? AUDIO_EVENTS[ei].files.length : 0;
      }
      var pct2 = expected > 0 ? Math.round(info.count / expected * 100) : 100;
      var bc = pct2 === 100 ? "mon-bar-fill-green" : pct2 > 0 ? "mon-bar-fill-gold" : "mon-bar-fill-red";
      catRows.push({
        k: cat,
        vRaw: '<span class="mon-val-group">' + barHtml(pct2, bc)
          + '<span class="' + (pct2 === 100 ? "mon-green" : "mon-gold") + '">'
          + info.count + (expected ? "/" + expected : "") + '</span>'
          + (info.size ? '<span class="mon-dim"> ' + fmtBytes(info.size) + '</span>' : '')
          + '</span>'
      });
    });
  }
  html += renderMonitorSection("📦 CACHE STORAGE (Service Worker)", sw.supported ? [
    { k: "Файлов в кэше",          v: sw.totalCount + " шт." },
    { k: "Размер (content-length)", v: sw.totalSize > 0 ? fmtBytes(sw.totalSize) : "нет заголовков" },
    { k: "Имена кэшей",             v: (sw.cacheNames || []).join(", ") || "—" },
  ].concat(catRows) : [
    { k: "Статус", v: "Не поддерживается (file://?)", valCls: "mon-red" }
  ]);

  // ── JS HEAP ──
  if (d.perf && d.perf.heapUsed) {
    var hp = Math.round(d.perf.heapUsed / d.perf.heapLimit * 100);
    html += renderMonitorSection("💾 ПАМЯТЬ БРАУЗЕРА (JS Heap)", [
      { k: "Использовано",
        vRaw: '<span class="mon-val-group"><span class="' + (hp > 80 ? "mon-red" : "mon-green") + '">'
          + fmtBytes(d.perf.heapUsed) + '</span>' + barHtml(hp, hp > 80 ? "mon-bar-fill-red" : "mon-bar-fill-green") + '</span>' },
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
      { k: "Тип соединения",   v: d.net.effectiveType },
      { k: "Скорость",         v: d.net.downlink },
      { k: "RTT",              v: d.net.rtt },
      { k: "Экономия трафика", v: d.net.saveData },
    ]);
  }

  // ── LOCAL STORAGE ──
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

  container.innerHTML = html;

  // Прикрепляем обработчик toggle
  var details = document.getElementById("pcmDetails");
  if (details) {
    details.addEventListener('toggle', function () {
      _pcmDetailsOpen = this.open;
    });
  }

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

// ── КОПИРОВАНИЕ ───────────────────────────────────────────────

async function copyMonitorData() {
  var btn = document.getElementById("monitorCopyBtn");
  var d;
  try { d = await collectMonitorData(); } catch(e) { return; }

  var isIos = d.engineType === "ios";
  var lines = [];
  lines.push("═══════════════════════════════════════════");
  lines.push("  NAVAL COMBAT — МОНИТОР СИСТЕМЫ");
  lines.push("  " + new Date().toLocaleString("ru-RU"));
  lines.push("  Движок: " + (isIos ? "iOS / Web Audio API" : "Стандарт / HTMLAudioElement"));
  lines.push("═══════════════════════════════════════════");
  lines.push("");

  lines.push("── СЕССИЯ ──────────────────────────────────");
  lines.push("Комната:           " + d.game.roomId);
  lines.push("Никнейм:           " + d.game.nickname);
  lines.push("Слот:              " + d.game.mySlot);
  lines.push("Ввод заблокирован: " + d.game.locked);
  lines.push("Polling:           " + d.game.pollActive);
  lines.push("Solo-режим:        " + d.game.soloActive);
  if (d.game.soloActive === "ДА") lines.push("Solo фаза/ход:     " + d.game.soloPhase + " / " + d.game.soloTurn);
  lines.push("Вид:               " + d.game.view);
  lines.push("");

  lines.push("── АУДИО ОБЩЕЕ ─────────────────────────────");
  lines.push("Звук:          " + (d.audio.enabled ? "ВКЛ" : "ВЫКЛ"));
  lines.push("Разблокирован: " + (d.audio.unlocked ? "ДА" : "НЕТ"));
  lines.push("Громкость:     " + d.audio.volume);
  lines.push("Очередь:       " + (d.audio.queueLen || 0) + (d.audio.queuePlaying ? " (воспроизводится)" : ""));
  lines.push("");

  if (isIos && d.audioIos) {
    var ai = d.audioIos;
    lines.push("── WEB AUDIO API — КОНТЕКСТ ────────────────");
    lines.push("Состояние:         " + ai.ctxState);
    lines.push("Частота дискр.:    " + ai.ctxSampleRate);
    lines.push("Текущее время:     " + ai.ctxTime);
    lines.push("Задержка:          " + ai.ctxLatency);
    lines.push("Каналов вывода:    " + ai.ctxChannels);
    lines.push("Master Gain:       " + ai.masterGain);
    lines.push("Инициализирован:   " + (ai.initialized ? "ДА" : "НЕТ"));
    lines.push("Ожидает жеста:     " + (ai.pendingInit ? "ДА" : "НЕТ"));
    lines.push("");
    lines.push("── WEB AUDIO API — БУФЕРЫ ──────────────────");
    lines.push("Декодировано:      " + ai.buffersDecoded + " файлов");
    lines.push("Память (PCM):      " + fmtBytes(ai.buffersPcmBytes) + " (реальная, float32)");
    lines.push("Загружаются:       " + ai.inflightCount);
    lines.push("Активных источн.:  " + ai.activeSources);
    lines.push("Макс. одноврем.:   " + ai.maxConcurrency);
    lines.push("HTMLAudio legacy:  " + ai.htmlCacheCount);
    lines.push("");
  } else if (d.audioStd) {
    var std = d.audioStd;
    lines.push("── HTMLAudioElement — КЭШ ──────────────────");
    lines.push("Объектов:    " + (std.totalCached || 0));
    lines.push("Активных:    " + (std.activeCount || 0));
    lines.push("Простаивает: " + (std.idleCount || 0));
    lines.push("Память ~:    " + fmtBytes(std.estimatedMem) + " (приблизительно, 128kbps)");
    if (std.activeList && std.activeList.length) {
      lines.push("Играют сейчас:");
      std.activeList.forEach(function(it) {
        lines.push("  " + it.src.split("/").slice(-2).join("/") + " (" + fmtBytes(it.est) + ")");
      });
    }
    lines.push("");
  }

  if (d.preload && (d.preload.started || d.preload.done)) {
    lines.push("── ПРЕДЗАГРУЗКА ────────────────────────────");
    lines.push("Статус:    " + (d.preload.done ? "ЗАВЕРШЕНО" : "ЗАГРУЗКА..."));
    lines.push("Прогресс:  " + d.preload.finished + "/" + d.preload.total + " (" + d.preload.pct + "%)");
    if (!d.preload.done) { lines.push("Фаза: " + d.preload.phase); lines.push("Сейчас: " + String(d.preload.current).split("/").pop()); }
    lines.push("");
  }

  lines.push("── CACHE STORAGE ───────────────────────────");
  if (!d.swCache.supported) {
    lines.push("Не поддерживается");
  } else {
    lines.push("Файлов: " + d.swCache.totalCount + ",  размер: " + (d.swCache.totalSize > 0 ? fmtBytes(d.swCache.totalSize) : "н/д"));
    if (d.swCache.byCategory) {
      Object.keys(d.swCache.byCategory).sort().forEach(function(cat) {
        var info = d.swCache.byCategory[cat];
        lines.push("  " + cat + ": " + info.count + (info.size ? " (" + fmtBytes(info.size) + ")" : ""));
      });
    }
  }
  lines.push("");

  if (d.perf && d.perf.heapUsed) {
    lines.push("── JS HEAP ─────────────────────────────────");
    lines.push("Использовано:  " + fmtBytes(d.perf.heapUsed) + " / " + fmtBytes(d.perf.heapLimit));
    lines.push("Загрузка стр.: " + fmtMs(d.perf.pageLoad) + ",  DOM: " + fmtMs(d.perf.domReady));
    lines.push("");
  }

  if (d.net && d.net.effectiveType) {
    lines.push("── СЕТЬ ────────────────────────────────────");
    lines.push(d.net.effectiveType + ",  " + d.net.downlink + ",  RTT " + d.net.rtt);
    lines.push("");
  }

  if (d.ls && d.ls.totalKeys != null) {
    lines.push("── LOCAL STORAGE ───────────────────────────");
    lines.push(d.ls.totalKeys + " ключей,  " + fmtBytes(d.ls.totalSize));
    (d.ls.mbKeys || []).forEach(function(it) { lines.push("  " + it.key + ": " + fmtBytes(it.size)); });
    lines.push("");
  }

  lines.push("═══════════════════════════════════════════");
  var text = lines.join("\n");

  try {
    await navigator.clipboard.writeText(text);
    _showCopyFeedback(btn, "✓");
  } catch(e) {
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
  setTimeout(function() { btn.textContent = orig; btn.classList.remove("copied", "copy-fail"); }, 1400);
}