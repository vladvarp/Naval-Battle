// ============================================================
// NAVAL COMBAT — Network Tracker v1.0
// network_tracker.js — полный мониторинг сетевых запросов
// ============================================================

// ── ХРАНИЛИЩЕ ТРЕКЕРА ─────────────────────────────────────────

var networkTracker = {
    requests: [],        // массив всех запросов
    maxRequests: 500,    // максимальное число хранимых
    interceptInstalled: false,
    startTime: Date.now(),
    stats: {
      totalRequests: 0,
      totalBytesSent: 0,
      totalBytesReceived: 0,
      totalErrors: 0,
      byType: {},
      byDomain: {},
      byStatus: {}
    }
  };
  
  var _trackerInterval = null;
  var _trackerStartMs = Date.now();
  
  // ── ПЕРЕХВАТ FETCH ─────────────────────────────────────────────
  
  function installNetworkInterceptor() {
    if (networkTracker.interceptInstalled) return;
    networkTracker.interceptInstalled = true;
  
    var _origFetch = window.fetch;
  
    window.fetch = function(input, init) {
      // Если трекер на паузе — не логируем запросы (и не трогаем статистику),
      // просто пробрасываем вызов в оригинальный fetch.
      try {
        if (typeof trackerUI !== "undefined" && trackerUI && trackerUI.paused) {
          return _origFetch.call(window, input, init);
        }
      } catch (e) {}

      var url = typeof input === "string" ? input : (input && input.url ? input.url : String(input));
      var method = (init && init.method) || (input && input.method) || "GET";
      var body = (init && init.body) || (input && input.body) || null;
      var headers = (init && init.headers) || (input && input.headers) || {};
  
      var bodySize = 0;
      var bodyPreview = "";
      if (body) {
        var bs = typeof body === "string" ? body : JSON.stringify(body);
        bodySize = new Blob([bs]).size;
        bodyPreview = bs.length > 300 ? bs.slice(0, 300) + "…" : bs;
      }
  
      // Разбираем тело запроса как JSON если возможно
      var parsedBody = null;
      if (body && typeof body === "string") {
        try { parsedBody = JSON.parse(body); } catch(e) {}
      }
  
      var reqId = "r_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
      var category = classifyRequest(url, method, parsedBody);
  
      var entry = {
        id: reqId,
        timestamp: Date.now(),
        relativeMs: Date.now() - networkTracker.startTime,
        url: url,
        method: method,
        category: category,
        domain: extractDomain(url),
        bodySize: bodySize,
        bodyPreview: bodyPreview,
        parsedBody: parsedBody,
        requestHeaders: safeSerializeHeaders(headers),
        status: null,
        statusText: null,
        responseSize: 0,
        responsePreview: null,
        responseHeaders: {},
        durationMs: null,
        error: null,
        pending: true
      };
  
      networkTracker.requests.unshift(entry);
      if (networkTracker.requests.length > networkTracker.maxRequests) {
        networkTracker.requests.pop();
      }
  
      networkTracker.stats.totalRequests++;
      networkTracker.stats.totalBytesSent += bodySize;
      countStat("byType", category);
      countStat("byDomain", entry.domain);
  
      var t0 = performance.now();
  
      return _origFetch.call(window, input, init).then(function(response) {
        var t1 = performance.now();
        entry.durationMs = Math.round(t1 - t0);
        entry.status = response.status;
        entry.statusText = response.statusText;
        entry.pending = false;
  
        countStat("byStatus", String(response.status));
        if (response.status >= 400) networkTracker.stats.totalErrors++;
  
        // Клонируем ответ, чтобы прочитать тело
        try {
          var respClone = response.clone();
          var ct = response.headers.get("content-type") || "";
          entry.responseHeaders = safeSerializeResponseHeaders(response.headers);
  
          var cl = response.headers.get("content-length");
          if (cl) {
            entry.responseSize = parseInt(cl) || 0;
            networkTracker.stats.totalBytesReceived += entry.responseSize;
          }
  
          if (ct.includes("json") || ct.includes("text")) {
            respClone.text().then(function(text) {
              var size = new Blob([text]).size;
              entry.responseSize = size;
              networkTracker.stats.totalBytesReceived += size;
              if (text.length > 500) {
                entry.responsePreview = text.slice(0, 500) + "…";
              } else {
                entry.responsePreview = text;
              }
              // Пробуем распарсить JSON
              try {
                var parsed = JSON.parse(text);
                entry.responseParsed = parsed;
                // Сервер может вернуть logical error в JSON при HTTP 200.
                // Такие ответы тоже должны подсвечиваться как ошибки в списке.
                if (!entry.error && parsed && parsed.ok === false && parsed.error) {
                  entry.error = String(parsed.error);
                  if (response.status < 400) {
                    networkTracker.stats.totalErrors++;
                    countStat("byStatus", "error");
                  }
                }
              } catch(e) {}
            }).catch(function(){});
          } else if (ct.includes("audio") || ct.includes("mpeg")) {
            respClone.arrayBuffer().then(function(buf) {
              entry.responseSize = buf.byteLength;
              networkTracker.stats.totalBytesReceived += buf.byteLength;
              entry.responsePreview = "[аудио-данные, " + fmtBytesTracker(buf.byteLength) + "]";
            }).catch(function(){});
          }
        } catch(e) {}
  
        return response;
      }, function(err) {
        var t1 = performance.now();
        entry.durationMs = Math.round(t1 - t0);
        entry.error = String(err);
        entry.pending = false;
        entry.status = 0;
        networkTracker.stats.totalErrors++;
        countStat("byStatus", "error");
        throw err;
      });
    };
  
    console.log("📡 Network Tracker: перехватчик fetch установлен");
  }
  
  function safeSerializeHeaders(headers) {
    try {
      if (!headers) return {};
      if (typeof headers.entries === "function") {
        var obj = {};
        for (var pair of headers.entries()) obj[pair[0]] = pair[1];
        return obj;
      }
      if (typeof headers === "object") return JSON.parse(JSON.stringify(headers));
      return {};
    } catch(e) { return {}; }
  }
  
  function safeSerializeResponseHeaders(headers) {
    try {
      if (!headers || typeof headers.entries !== "function") return {};
      var obj = {};
      headers.forEach(function(v, k) { obj[k] = v; });
      return obj;
    } catch(e) { return {}; }
  }
  
  function extractDomain(url) {
    try {
      if (url.startsWith("https://script.google.com") || url.includes("googleapis")) return "Google API";
      if (url.includes("/audio/") || url.match(/\.(mp3|ogg|wav)$/)) return "Audio CDN";
      if (url.includes("sw.js") || url.includes("service")) return "ServiceWorker";
      var u = new URL(url, location.href);
      return u.hostname;
    } catch(e) {
      if (url.startsWith("./") || url.startsWith("/")) return location.hostname || "local";
      return "unknown";
    }
  }
  
  function classifyRequest(url, method, body) {
    if (url.includes("script.google.com") || url.includes("googleapis.com/macros")) {
      if (!body) return "api:state";
      var action = body && body.action;
      if (action === "move") return "api:move";
      if (action === "createRoom") return "api:createRoom";
      if (action === "joinRoom") return "api:joinRoom";
      if (action === "leave") return "api:leave";
      if (action === "listRoomsAdmin") return "api:admin";
      if (action === "restart") return "api:admin";
      if (url.includes("action=state")) return "api:state";
      if (url.includes("action=getRooms")) return "api:getRooms";
      return "api:other";
    }
    if (url.match(/\.(mp3|ogg|wav|aac)($|\?)/i) || url.includes("/audio/")) return "audio";
    if (url.includes("sw.js")) return "serviceworker";
    if (url.includes("googleapis.com/css") || url.includes("fonts.g")) return "fonts";
    if (url.includes("cdnjs") || url.includes("jsdelivr") || url.includes("unpkg")) return "cdn";
    if (method === "GET" && (url.includes(".js") || url.includes(".css") || url.includes(".html"))) return "static";
    return "other";
  }
  
  function countStat(key, value) {
    if (!networkTracker.stats[key][value]) networkTracker.stats[key][value] = 0;
    networkTracker.stats[key][value]++;
  }
  
  // ── УТИЛИТЫ ───────────────────────────────────────────────────
  
  function fmtBytesTracker(b) {
    if (b == null || isNaN(b) || b === 0) return "0 Б";
    if (b < 1024) return b + " Б";
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " КБ";
    return (b / 1024 / 1024).toFixed(2) + " МБ";
  }
  
  function fmtMsTracker(ms) {
    if (ms == null || ms === 0) return "—";
    if (ms < 1000) return ms + " мс";
    return (ms / 1000).toFixed(2) + " с";
  }
  
  function fmtRelTime(ms) {
    var s = Math.floor(ms / 1000);
    var m = Math.floor(s / 60);
    if (m > 0) return "+" + m + "м" + (s % 60) + "с";
    return "+" + s + "с";
  }

  function getTrackerErrorText(r) {
    if (!r) return "";
    if (r.error) return String(r.error);
    if (r.responseParsed && r.responseParsed.ok === false && r.responseParsed.error) {
      return String(r.responseParsed.error);
    }
    // Фолбэк: иногда JSON-парсинг не успевает к моменту рендера/экспорта,
    // но responsePreview уже содержит текст ответа.
    if (r.responsePreview && typeof r.responsePreview === "string") {
      try {
        var parsedPreview = JSON.parse(r.responsePreview);
        if (parsedPreview && parsedPreview.ok === false && parsedPreview.error) {
          return String(parsedPreview.error);
        }
      } catch(e) {}
      var m = r.responsePreview.match(/"error"\s*:\s*"([^"]+)"/i);
      if (m && m[1]) return m[1];
    }
    return "";
  }
  
  function escH(s) {
    return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }
  
  function getCategoryColor(cat) {
    if (!cat) return "rgba(168,228,255,0.4)";
    if (cat.startsWith("api:move")) return "#ff9900";
    if (cat.startsWith("api:state") || cat.startsWith("api:getRooms")) return "#1a9fd4";
    if (cat.startsWith("api:createRoom") || cat.startsWith("api:joinRoom")) return "#7dffb3";
    if (cat.startsWith("api:leave")) return "#ff9999";
    if (cat.startsWith("api:admin")) return "#f0c040";
    if (cat.startsWith("api")) return "#a8e4ff";
    if (cat === "audio") return "#b39ddb";
    if (cat === "serviceworker") return "#80cbc4";
    if (cat === "cdn" || cat === "fonts") return "#ffcc80";
    if (cat === "static") return "#bcaaa4";
    return "rgba(168,228,255,0.4)";
  }
  
  function getStatusColor(status) {
    if (!status || status === 0) return "#ff6b6b";
    if (status >= 200 && status < 300) return "#7dffb3";
    if (status >= 300 && status < 400) return "#ffcc80";
    if (status >= 400) return "#ff6b6b";
    return "#a8e4ff";
  }
  
  // ── СОСТОЯНИЕ UI ──────────────────────────────────────────────
  
  var trackerUI = {
    filterCat: "all",
    sortBy: "time",
    expandedId: null,
    paused: true,
    searchText: "",
    widgetEnabled: false
  };

  // Запоминаем состояние UI между перезагрузками
  (function restoreTrackerUIState() {
    try {
      var raw = localStorage.getItem("mb_tracker_paused");
      if (raw === "1") trackerUI.paused = true;
      else if (raw === "0") trackerUI.paused = false;
    } catch (e) {}
    try {
      var wr = localStorage.getItem("mb_tracker_widget_enabled");
      if (wr === "0") trackerUI.widgetEnabled = false;
      else if (wr === "1") trackerUI.widgetEnabled = true;
    } catch (e) {}
  })();

  function applyTrackerPauseUI() {
    var btn = document.getElementById("trackerPauseBtn");
    if (btn) {
      btn.textContent = trackerUI.paused ? "▶" : "⏸";
      btn.title = trackerUI.paused ? "Продолжить" : "Пауза";
      btn.classList.toggle("copied", trackerUI.paused);
    }
    var dot = document.getElementById("trackerLiveDot");
    if (dot) dot.style.animationPlayState = trackerUI.paused ? "paused" : "running";
  }

  function applyTrackerWidgetBtnUI() {
    var btn = document.getElementById("trackerWidgetBtn");
    if (!btn) return;
    btn.textContent = trackerUI.widgetEnabled ? "NET" : "net";
    btn.title = trackerUI.widgetEnabled ? "Виджет NET: включен" : "Виджет NET: выключен";
    btn.classList.toggle("copied", trackerUI.widgetEnabled);
  }

  function emitTrackerWidgetState() {
    try {
      window.dispatchEvent(new CustomEvent("mb_tracker_widget_changed", {
        detail: { enabled: !!trackerUI.widgetEnabled }
      }));
    } catch (e) {}
  }
  
  // ── ОТКРЫТЬ / ЗАКРЫТЬ ТРЕКЕР ──────────────────────────────────
  
  function openNetworkTracker() {
    installNetworkInterceptor();
    var overlay = document.getElementById("networkTrackerOverlay");
    if (!overlay) {
      buildNetworkTrackerDOM();
      overlay = document.getElementById("networkTrackerOverlay");
    }
    if (!overlay) return;
    overlay.classList.add("show");
    applyTrackerPauseUI();
    applyTrackerWidgetBtnUI();
    renderNetworkTracker();
    _trackerInterval = setInterval(function() {
      if (!trackerUI.paused) renderNetworkTracker();
    }, 400);
  }
  
  function closeNetworkTracker() {
    var overlay = document.getElementById("networkTrackerOverlay");
    if (overlay) overlay.classList.remove("show");
    if (_trackerInterval) { clearInterval(_trackerInterval); _trackerInterval = null; }
  }
  
  // ── СТРОИМ DOM ОВЕРЛЕЯ ────────────────────────────────────────
  
  function buildNetworkTrackerDOM() {
    var div = document.createElement("div");
    div.id = "networkTrackerOverlay";
    div.className = "monitor-overlay";
    div.style.cssText = "z-index:2200;padding:8px 12px;";
    div.innerHTML = `
  <div class="monitor-card" style="max-width:min(820px,calc(100vw - 24px));width:100%;padding:0;">
    <div class="monitor-header" style="padding:14px 18px 12px;">
      <div class="monitor-title" style="font-size:12px;letter-spacing:3px;">📡 NETWORK TRACKER</div>
      <div class="monitor-meta" style="display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;">
        <button class="monitor-copy" id="trackerPauseBtn" onclick="toggleTrackerPause()" title="Пауза/Продолжить">⏸</button>
        <button class="monitor-copy" id="trackerWidgetBtn" onclick="toggleTrackerWidget()" title="Виджет NET">NET</button>
        <button class="monitor-copy" id="trackerClearBtn" onclick="clearTrackerHistory()" title="Очистить">🗑</button>
        <button class="monitor-copy" id="trackerExportBtn" onclick="exportTrackerData()" title="Экспорт">⎘</button>
        <button class="monitor-close" onclick="closeNetworkTracker()">✕</button>
        <div style="flex:1 0 100%;display:flex;justify-content:flex-end;align-items:center;gap:6px;margin-top:2px;">
          <div class="monitor-live-dot" id="trackerLiveDot"></div>
          <span class="monitor-ts" id="trackerTimestamp">инициализация...</span>
        </div>
      </div>
    </div>
  
    <div id="trackerStatsBar" style="display:flex;gap:8px;flex-wrap:wrap;padding:8px 18px;border-bottom:1px solid rgba(26,159,212,0.12);background:rgba(2,13,24,0.4);"></div>
  
    <div style="display:flex;gap:8px;align-items:center;padding:8px 18px;border-bottom:1px solid rgba(26,159,212,0.1);flex-wrap:wrap;">
      <select id="trackerCatFilter" onchange="trackerUI.filterCat=this.value;renderNetworkTracker()" style="background:rgba(2,13,24,0.8);border:1px solid rgba(26,159,212,0.3);border-radius:5px;color:var(--foam);font-family:'Share Tech Mono',monospace;font-size:10px;padding:4px 8px;letter-spacing:1px;cursor:pointer;">
        <option value="all">ВСЕ ЗАПРОСЫ</option>
        <option value="api:state">API: Polling</option>
        <option value="api:move">API: Ходы</option>
        <option value="api:createRoom">API: Комнаты</option>
        <option value="api:admin">API: Админ</option>
        <option value="audio">Аудио</option>
        <option value="serviceworker">ServiceWorker</option>
        <option value="other">Прочее</option>
      </select>
      <input id="trackerSearch" type="text" placeholder="Поиск по URL..." oninput="trackerUI.searchText=this.value;renderNetworkTracker()" style="background:rgba(2,13,24,0.8);border:1px solid rgba(26,159,212,0.3);border-radius:5px;color:var(--white);font-family:'Share Tech Mono',monospace;font-size:10px;padding:4px 8px;flex:1;min-width:120px;letter-spacing:0.5px;" autocomplete="off">
      <select id="trackerSortBy" onchange="trackerUI.sortBy=this.value;renderNetworkTracker()" style="background:rgba(2,13,24,0.8);border:1px solid rgba(26,159,212,0.3);border-radius:5px;color:var(--foam);font-family:'Share Tech Mono',monospace;font-size:10px;padding:4px 8px;letter-spacing:1px;cursor:pointer;">
        <option value="time">↓ ПО ВРЕМЕНИ</option>
        <option value="size">↓ ПО РАЗМЕРУ</option>
        <option value="duration">↓ ПО СКОРОСТИ</option>
      </select>
      <span id="trackerCount" style="font-size:9px;color:rgba(168,228,255,0.35);letter-spacing:1px;white-space:nowrap;"></span>
    </div>
  
    <div id="trackerBody" style="padding:0;max-height:min(62vh,520px);overflow-y:auto;"></div>
  
    <div id="trackerDetailPanel" style="display:none;border-top:1px solid rgba(26,159,212,0.15);background:rgba(2,13,24,0.7);padding:14px 18px;max-height:260px;overflow-y:auto;"></div>
  </div>`;
    document.body.appendChild(div);
  
    // Закрыть по клику на фон
    div.addEventListener("click", function(e) {
      if (e.target === div) closeNetworkTracker();
    });
  }
  
  // ── РЕНДЕР ТРЕКЕРА ────────────────────────────────────────────
  
  function renderNetworkTracker() {
    renderTrackerStats();
    renderTrackerList();
    var ts = document.getElementById("trackerTimestamp");
    if (ts) ts.textContent = "обновлено " + new Date().toLocaleTimeString("ru-RU");
  }
  
  function renderTrackerStats() {
    var bar = document.getElementById("trackerStatsBar");
    if (!bar) return;
    var st = networkTracker.stats;
    var uptime = Math.floor((Date.now() - networkTracker.startTime) / 1000);
  
    var statItems = [
      { label: "ЗАПРОСОВ", value: st.totalRequests, color: "#1a9fd4" },
      { label: "ОТПРАВЛЕНО", value: fmtBytesTracker(st.totalBytesSent), color: "#ff9900" },
      { label: "ПОЛУЧЕНО", value: fmtBytesTracker(st.totalBytesReceived), color: "#7dffb3" },
      { label: "ОШИБОК", value: st.totalErrors, color: st.totalErrors > 0 ? "#ff6b6b" : "#7dffb3" },
      { label: "СЕССИЯ", value: fmtMsTracker(uptime * 1000), color: "#a8e4ff" },
      { label: "ПЕРЕХВАТ", value: networkTracker.interceptInstalled ? "✓ ВКЛ" : "✗ ВЫКЛ", color: networkTracker.interceptInstalled ? "#7dffb3" : "#ff6b6b" }
    ];
  
    var html = statItems.map(function(s) {
      return '<div style="display:flex;flex-direction:column;gap:2px;background:rgba(2,13,24,0.55);border:1px solid rgba(26,159,212,0.12);border-radius:6px;padding:6px 10px;min-width:70px;">'
        + '<span style="font-size:8px;letter-spacing:1.5px;color:rgba(168,228,255,0.35);">' + s.label + '</span>'
        + '<span style="font-size:12px;font-weight:600;color:' + s.color + ';letter-spacing:0.5px;">' + escH(String(s.value)) + '</span>'
        + '</div>';
    }).join("");
  
    // Топ-3 по количеству вызовов
    var catKeys = Object.keys(st.byType || {}).sort(function(a,b){ return (st.byType[b]||0)-(st.byType[a]||0); }).slice(0, 3);
    if (catKeys.length) {
      html += '<div style="flex:1;background:rgba(2,13,24,0.35);border:1px solid rgba(26,159,212,0.1);border-radius:6px;padding:6px 10px;min-width:140px;">'
        + '<div style="font-size:8px;letter-spacing:1.5px;color:rgba(168,228,255,0.35);margin-bottom:4px;">ТОП КАТЕГОРИИ</div>';
      catKeys.forEach(function(k) {
        var pct = Math.round((st.byType[k] / st.totalRequests) * 100);
        html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">'
          + '<span style="width:6px;height:6px;border-radius:50%;background:' + getCategoryColor(k) + ';flex-shrink:0;"></span>'
          + '<span style="font-size:9px;color:rgba(168,228,255,0.7);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escH(k) + '</span>'
          + '<span style="font-size:9px;color:rgba(168,228,255,0.5);">' + st.byType[k] + ' (' + pct + '%)</span>'
          + '</div>';
      });
      html += '</div>';
    }
  
    bar.innerHTML = html;
  }
  
  function renderTrackerList() {
    var body = document.getElementById("trackerBody");
    var countEl = document.getElementById("trackerCount");
    if (!body) return;
  
    var reqs = networkTracker.requests.slice();
    var filterCat = trackerUI.filterCat;
    var search = (trackerUI.searchText || "").toLowerCase();
  
    // Фильтр
    if (filterCat !== "all") {
      reqs = reqs.filter(function(r) { return r.category === filterCat || r.category.startsWith(filterCat); });
    }
    if (search) {
      reqs = reqs.filter(function(r) { return r.url.toLowerCase().includes(search) || (r.category || "").includes(search); });
    }
  
    // Сортировка
    if (trackerUI.sortBy === "size") {
      reqs.sort(function(a,b){ return (b.responseSize || 0) - (a.responseSize || 0); });
    } else if (trackerUI.sortBy === "duration") {
      reqs.sort(function(a,b){ return (b.durationMs || 0) - (a.durationMs || 0); });
    }
  
    if (countEl) countEl.textContent = reqs.length + " / " + networkTracker.requests.length;
  
    if (!reqs.length) {
      body.innerHTML = '<div style="padding:24px;text-align:center;color:rgba(168,228,255,0.3);font-size:11px;letter-spacing:1px;">'
        + (networkTracker.requests.length === 0
          ? '📡 Ожидание запросов...<br><span style="font-size:9px;opacity:0.6;">Перехватчик установлен — все fetch() будут отображены здесь</span>'
          : '🔍 Нет запросов по выбранному фильтру')
        + '</div>';
      return;
    }
  
    var html = '<table style="width:100%;border-collapse:collapse;font-size:10px;">';
    html += '<thead><tr style="background:rgba(2,13,24,0.9);position:sticky;top:0;z-index:5;">'
      + '<th style="padding:6px 8px;text-align:left;font-size:8px;letter-spacing:1.5px;color:rgba(168,228,255,0.35);font-weight:600;border-bottom:1px solid rgba(26,159,212,0.15);width:52px;">ВРЕМЯ</th>'
      + '<th style="padding:6px 8px;text-align:left;font-size:8px;letter-spacing:1.5px;color:rgba(168,228,255,0.35);font-weight:600;border-bottom:1px solid rgba(26,159,212,0.15);width:72px;">КАТ.</th>'
      + '<th style="padding:6px 8px;text-align:left;font-size:8px;letter-spacing:1.5px;color:rgba(168,228,255,0.35);font-weight:600;border-bottom:1px solid rgba(26,159,212,0.15);">URL / ДЕЙСТВИЕ</th>'
      + '<th style="padding:6px 8px;text-align:right;font-size:8px;letter-spacing:1.5px;color:rgba(168,228,255,0.35);font-weight:600;border-bottom:1px solid rgba(26,159,212,0.15);width:48px;">↑ ОТП.</th>'
      + '<th style="padding:6px 8px;text-align:right;font-size:8px;letter-spacing:1.5px;color:rgba(168,228,255,0.35);font-weight:600;border-bottom:1px solid rgba(26,159,212,0.15);width:48px;">↓ ПОЛ.</th>'
      + '<th style="padding:6px 8px;text-align:right;font-size:8px;letter-spacing:1.5px;color:rgba(168,228,255,0.35);font-weight:600;border-bottom:1px solid rgba(26,159,212,0.15);width:54px;">ВР.</th>'
      + '<th style="padding:6px 8px;text-align:center;font-size:8px;letter-spacing:1.5px;color:rgba(168,228,255,0.35);font-weight:600;border-bottom:1px solid rgba(26,159,212,0.15);width:44px;">КОД</th>'
      + '</tr></thead><tbody>';
  
    reqs.forEach(function(r) {
      var errText = getTrackerErrorText(r);
      var isExpanded = trackerUI.expandedId === r.id;
      var rowBg = isExpanded ? "rgba(26,159,212,0.08)" : (errText ? "rgba(255,68,68,0.05)" : "transparent");
      var urlShort = shortenUrl(r.url);
      var actionLabel = getActionLabel(r);
      var statusColor = r.pending ? "#f0c040" : (errText ? "#ff6b6b" : getStatusColor(r.status));
      var statusText = r.pending ? "⏳" : (errText ? "ERR" : (r.status || "ERR"));
  
      html += '<tr onclick="toggleTrackerDetail(\'' + r.id + '\')" style="cursor:pointer;background:' + rowBg + ';border-bottom:1px solid rgba(26,159,212,0.06);transition:background 0.1s;" onmouseover="this.style.background=\'rgba(26,159,212,0.06)\'" onmouseout="this.style.background=\'' + rowBg + '\'">'
        + '<td style="padding:5px 8px;color:rgba(168,228,255,0.4);white-space:nowrap;font-size:9px;">' + fmtRelTime(r.relativeMs) + '</td>'
        + '<td style="padding:5px 8px;">'
          + '<span style="font-size:8px;padding:2px 5px;border-radius:3px;background:' + getCategoryColor(r.category) + '22;border:1px solid ' + getCategoryColor(r.category) + '55;color:' + getCategoryColor(r.category) + ';white-space:nowrap;letter-spacing:0.3px;">' + escH(r.category) + '</span>'
        + '</td>'
        + '<td style="padding:5px 8px;max-width:0;">'
          + '<div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--white);">' + escH(actionLabel || urlShort) + '</div>'
          + (actionLabel ? '<div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:rgba(168,228,255,0.35);font-size:9px;">' + escH(urlShort) + '</div>' : '')
        + '</td>'
        + '<td style="padding:5px 8px;text-align:right;color:rgba(255,153,0,0.8);white-space:nowrap;">' + (r.bodySize > 0 ? fmtBytesTracker(r.bodySize) : '—') + '</td>'
        + '<td style="padding:5px 8px;text-align:right;color:rgba(125,255,179,0.8);white-space:nowrap;">' + (r.responseSize > 0 ? fmtBytesTracker(r.responseSize) : (r.pending ? '…' : '—')) + '</td>'
        + '<td style="padding:5px 8px;text-align:right;color:rgba(168,228,255,0.6);white-space:nowrap;">' + (r.durationMs != null ? fmtMsTracker(r.durationMs) : '…') + '</td>'
        + '<td style="padding:5px 8px;text-align:center;">'
          + '<span style="font-size:9px;font-weight:600;color:' + statusColor + ';">' + escH(String(statusText)) + '</span>'
        + '</td>'
        + '</tr>';
  
      // Развёрнутая деталь — встроенная строка
      if (isExpanded) {
        html += '<tr><td colspan="7" style="padding:0;background:rgba(2,13,24,0.7);border-bottom:2px solid rgba(26,159,212,0.2);">'
          + renderRequestDetail(r)
          + '</td></tr>';
      }
    });
  
    html += '</tbody></table>';
    body.innerHTML = html;
  }
  
  function toggleTrackerDetail(reqId) {
    if (trackerUI.expandedId === reqId) {
      trackerUI.expandedId = null;
    } else {
      trackerUI.expandedId = reqId;
    }
    renderTrackerList();
  }
  
  function renderRequestDetail(r) {
    var errText = getTrackerErrorText(r);
    var html = '<div style="padding:12px 18px;font-size:10px;display:flex;flex-wrap:wrap;gap:14px;">';
  
    // Метаданные
    html += '<div style="flex:1;min-width:200px;">';
    html += '<div style="font-size:8px;letter-spacing:2px;color:rgba(168,228,255,0.4);margin-bottom:8px;border-bottom:1px solid rgba(26,159,212,0.1);padding-bottom:4px;">МЕТАДАННЫЕ</div>';
    html += metaRow("URL", '<span style="word-break:break-all;color:var(--foam);">' + escH(r.url) + '</span>');
    html += metaRow("Метод", '<span style="color:#f0c040;">' + escH(r.method) + '</span>');
    html += metaRow("Категория", escH(r.category));
    html += metaRow("Домен", escH(r.domain));
    html += metaRow("Время (±сессии)", escH(fmtRelTime(r.relativeMs)));
    html += metaRow("Дата/Время", new Date(r.timestamp).toLocaleString("ru-RU"));
    if (r.durationMs != null) html += metaRow("Длительность", '<span style="color:' + (r.durationMs > 2000 ? "#ff9999" : r.durationMs > 500 ? "#f0c040" : "#7dffb3") + ';">' + fmtMsTracker(r.durationMs) + '</span>');
    html += metaRow("Статус", '<span style="color:' + getStatusColor(r.status) + ';font-weight:600;">' + escH(String(r.status || (r.pending ? "PENDING" : "ERR"))) + ' ' + escH(r.statusText || "") + '</span>');
    if (errText) html += metaRow("Ошибка", '<span style="color:#ff6b6b;">' + escH(errText) + '</span>');
    html += '</div>';
  
    // Отправленные данные
    html += '<div style="flex:1;min-width:200px;">';
    html += '<div style="font-size:8px;letter-spacing:2px;color:rgba(255,153,0,0.6);margin-bottom:8px;border-bottom:1px solid rgba(26,159,212,0.1);padding-bottom:4px;">↑ ОТПРАВЛЕНО (' + fmtBytesTracker(r.bodySize) + ')</div>';
  
    // Заголовки запроса
    var reqHdrs = r.requestHeaders || {};
    if (Object.keys(reqHdrs).length) {
      html += '<div style="font-size:8px;color:rgba(168,228,255,0.3);margin:4px 0 2px;letter-spacing:1px;">ЗАГОЛОВКИ:</div>';
      Object.keys(reqHdrs).forEach(function(k) {
        html += metaRow(k, escH(String(reqHdrs[k])));
      });
    }
  
    // Тело запроса
    if (r.parsedBody) {
      html += '<div style="font-size:8px;color:rgba(168,228,255,0.3);margin:8px 0 4px;letter-spacing:1px;">ТЕЛО ЗАПРОСА (JSON):</div>';
      html += renderJsonObject(r.parsedBody);
    } else if (r.bodyPreview) {
      html += '<div style="font-size:8px;color:rgba(168,228,255,0.3);margin:8px 0 4px;letter-spacing:1px;">ТЕЛО ЗАПРОСА:</div>';
      html += '<pre style="margin:0;font-size:9px;color:rgba(168,228,255,0.7);background:rgba(2,13,24,0.5);padding:6px;border-radius:4px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;">' + escH(r.bodyPreview) + '</pre>';
    } else {
      html += '<div style="color:rgba(168,228,255,0.25);font-size:9px;margin-top:4px;">— нет тела —</div>';
    }
    html += '</div>';
  
    // Полученные данные
    html += '<div style="flex:1;min-width:200px;">';
    html += '<div style="font-size:8px;letter-spacing:2px;color:rgba(125,255,179,0.6);margin-bottom:8px;border-bottom:1px solid rgba(26,159,212,0.1);padding-bottom:4px;">↓ ПОЛУЧЕНО (' + fmtBytesTracker(r.responseSize) + ')</div>';
  
    // Заголовки ответа
    var respHdrs = r.responseHeaders || {};
    if (Object.keys(respHdrs).length) {
      html += '<div style="font-size:8px;color:rgba(168,228,255,0.3);margin:4px 0 2px;letter-spacing:1px;">ЗАГОЛОВКИ ОТВЕТА:</div>';
      ["content-type","content-length","cache-control","x-deny-reason","server","date"].forEach(function(k) {
        if (respHdrs[k]) html += metaRow(k, escH(String(respHdrs[k])));
      });
      var otherHdrs = Object.keys(respHdrs).filter(function(k) {
        return !["content-type","content-length","cache-control","x-deny-reason","server","date"].includes(k);
      });
      otherHdrs.forEach(function(k) { html += metaRow(k, escH(String(respHdrs[k]))); });
    }
  
    // Тело ответа
    if (r.responseParsed) {
      html += '<div style="font-size:8px;color:rgba(168,228,255,0.3);margin:8px 0 4px;letter-spacing:1px;">ТЕЛО ОТВЕТА (JSON):</div>';
      html += renderJsonObject(r.responseParsed);
    } else if (r.responsePreview) {
      html += '<div style="font-size:8px;color:rgba(168,228,255,0.3);margin:8px 0 4px;letter-spacing:1px;">ТЕЛО ОТВЕТА:</div>';
      html += '<pre style="margin:0;font-size:9px;color:rgba(125,255,179,0.7);background:rgba(2,13,24,0.5);padding:6px;border-radius:4px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;">' + escH(r.responsePreview) + '</pre>';
    } else if (r.pending) {
      html += '<div style="color:#f0c040;font-size:9px;margin-top:4px;">⏳ Ожидаем ответа...</div>';
    } else {
      html += '<div style="color:rgba(168,228,255,0.25);font-size:9px;margin-top:4px;">— нет данных —</div>';
    }
    html += '</div>';
  
    html += '</div>';
    return html;
  }
  
  function metaRow(k, vHtml) {
    return '<div style="display:flex;gap:6px;margin-bottom:3px;align-items:flex-start;">'
      + '<span style="color:rgba(168,228,255,0.4);white-space:nowrap;flex-shrink:0;min-width:100px;font-size:9px;">' + escH(k) + '</span>'
      + '<span style="color:var(--white);word-break:break-word;font-size:9px;">' + vHtml + '</span>'
      + '</div>';
  }
  
  function renderJsonObject(obj) {
    if (!obj || typeof obj !== "object") {
      return '<span style="color:rgba(168,228,255,0.6);">' + escH(String(obj)) + '</span>';
    }
    var html = '<div style="background:rgba(2,13,24,0.5);border-radius:4px;padding:6px 8px;font-size:9px;">';
    var keys = Object.keys(obj);
    keys.forEach(function(k) {
      var v = obj[k];
      var vStr, vColor;
      if (v === null) { vStr = "null"; vColor = "#ff9999"; }
      else if (typeof v === "boolean") { vStr = String(v); vColor = v ? "#7dffb3" : "#ff9999"; }
      else if (typeof v === "number") { vStr = String(v); vColor = "#f0c040"; }
      else if (typeof v === "string") {
        vStr = v.length > 80 ? '"' + v.slice(0, 80) + '…"' : '"' + v + '"';
        vColor = "#a8e4ff";
      }
      else if (Array.isArray(v)) { vStr = "[…" + v.length + " элем.]"; vColor = "#b39ddb"; }
      else if (typeof v === "object") { vStr = "{…" + Object.keys(v).length + " ключей}"; vColor = "#80cbc4"; }
      else { vStr = String(v); vColor = "rgba(168,228,255,0.7)"; }
  
      html += '<div style="display:flex;gap:8px;margin-bottom:2px;">'
        + '<span style="color:rgba(168,228,255,0.45);flex-shrink:0;">' + escH(k) + ':</span>'
        + '<span style="color:' + vColor + ';word-break:break-all;">' + escH(vStr) + '</span>'
        + '</div>';
    });
    html += '</div>';
    return html;
  }
  
  function shortenUrl(url) {
    try {
      if (url.includes("script.google.com")) {
        var m = url.match(/action=([^&]+)/);
        return m ? "GAS: " + m[1] : "Google Apps Script";
      }
      if (url.includes("/audio/")) {
        var parts = url.split("/audio/")[1] || "";
        return "audio/" + parts.split("/").slice(0, 2).join("/");
      }
      var u = new URL(url, location.href);
      var path = u.pathname;
      if (path.length > 50) path = "…" + path.slice(-47);
      return u.hostname + path;
    } catch(e) {
      return url.length > 60 ? url.slice(0, 57) + "…" : url;
    }
  }
  
  function getActionLabel(r) {
    if (r.parsedBody && r.parsedBody.action) {
      var labels = {
        "createRoom": "🏗 Создать комнату",
        "joinRoom": "🚪 Войти в комнату",
        "move": "🎯 Ход: " + (r.parsedBody.x != null ? String.fromCharCode(1040 + r.parsedBody.x) + (r.parsedBody.y + 1) : ""),
        "leave": "👋 Выйти из игры",
        "restart": "⚙ Удалить комнату",
        "listRoomsAdmin": "📋 Список комнат (admin)"
      };
      return labels[r.parsedBody.action] || ("API: " + r.parsedBody.action);
    }
    if (r.url.includes("action=state")) return "📊 Получить состояние игры";
    if (r.url.includes("action=getRooms")) return "🌊 Список комнат (лобби)";
    if (r.category === "audio") {
      var parts = r.url.split("/audio/")[1];
      return parts ? "🎵 Аудио: " + parts : null;
    }
    if (r.category === "serviceworker") return "⚙ Service Worker";
    return null;
  }
  
  // ── УПРАВЛЕНИЕ ТРЕКЕРОМ ───────────────────────────────────────
  
  function toggleTrackerPause() {
    trackerUI.paused = !trackerUI.paused;
    try { localStorage.setItem("mb_tracker_paused", trackerUI.paused ? "1" : "0"); } catch (e) {}
    applyTrackerPauseUI();
    if (!trackerUI.paused) renderNetworkTracker();
  }

  function toggleTrackerWidget() {
    trackerUI.widgetEnabled = !trackerUI.widgetEnabled;
    try { localStorage.setItem("mb_tracker_widget_enabled", trackerUI.widgetEnabled ? "1" : "0"); } catch (e) {}
    applyTrackerWidgetBtnUI();
    emitTrackerWidgetState();
  }
  
  function clearTrackerHistory() {
    networkTracker.requests = [];
    networkTracker.stats = {
      totalRequests: 0, totalBytesSent: 0, totalBytesReceived: 0, totalErrors: 0,
      byType: {}, byDomain: {}, byStatus: {}
    };
    trackerUI.expandedId = null;
    renderNetworkTracker();
  }
  
  async function exportTrackerData() {
    var btn = document.getElementById("trackerExportBtn");
    var lines = [];
    lines.push("═══════════════════════════════════════════");
    lines.push("  NAVAL COMBAT — NETWORK TRACKER EXPORT");
    lines.push("  " + new Date().toLocaleString("ru-RU"));
    lines.push("═══════════════════════════════════════════");
    lines.push("");
    lines.push("── СТАТИСТИКА ──────────────────────────────");
    var st = networkTracker.stats;
    var derivedErrors = networkTracker.requests.reduce(function(acc, r) {
      return acc + (getTrackerErrorText(r) ? 1 : 0);
    }, 0);
    lines.push("Всего запросов:   " + st.totalRequests);
    lines.push("Отправлено:       " + fmtBytesTracker(st.totalBytesSent));
    lines.push("Получено:         " + fmtBytesTracker(st.totalBytesReceived));
    lines.push("Ошибок:           " + Math.max(st.totalErrors, derivedErrors));
    lines.push("");
    lines.push("По категориям:");
    Object.keys(st.byType).sort().forEach(function(k) { lines.push("  " + k + ": " + st.byType[k]); });
    lines.push("По кодам ответа:");
    Object.keys(st.byStatus).sort().forEach(function(k) { lines.push("  " + k + ": " + st.byStatus[k]); });
    lines.push("");
    lines.push("── ЗАПРОСЫ ─────────────────────────────────");
    networkTracker.requests.forEach(function(r, i) {
      lines.push("\n[" + (i+1) + "] " + new Date(r.timestamp).toLocaleTimeString("ru-RU") + " | " + r.method + " | " + r.category);
      lines.push("    URL: " + r.url);
      if (r.parsedBody) lines.push("    BODY: " + JSON.stringify(r.parsedBody));
      var errText = getTrackerErrorText(r);
      lines.push("    STATUS: " + (errText ? "ERR" : (r.status || "ERR")) + " | TIME: " + fmtMsTracker(r.durationMs) + " | SENT: " + fmtBytesTracker(r.bodySize) + " | RECV: " + fmtBytesTracker(r.responseSize));
      if (errText) lines.push("    ERROR: " + errText);
      if (r.responsePreview) lines.push("    RESP: " + r.responsePreview.slice(0, 200));
    });
    lines.push("\n═══════════════════════════════════════════");
  
    var text = lines.join("\n");
    try {
      await navigator.clipboard.writeText(text);
      if (btn) { btn.textContent = "✓"; btn.classList.add("copied"); setTimeout(function(){ btn.textContent = "⎘"; btn.classList.remove("copied"); }, 1400); }
    } catch(e) {
      var ta = document.createElement("textarea");
      ta.value = text; ta.style.cssText = "position:fixed;opacity:0;top:0;left:0;";
      document.body.appendChild(ta); ta.focus(); ta.select();
      try { document.execCommand("copy"); if (btn) { btn.textContent = "✓"; btn.classList.add("copied"); setTimeout(function(){ btn.textContent = "⎘"; btn.classList.remove("copied"); }, 1400); } } catch(e2) {}
      document.body.removeChild(ta);
    }
  }