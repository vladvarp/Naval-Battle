// ── АУДИО ────────────────────────────────────────────────────


function waitAudioEnded(a) {
  return new Promise(function(resolve) {
    if (!a) { resolve(); return; }
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      try { a.removeEventListener("ended", finish); } catch(e) {}
      try { a.removeEventListener("error", finish); } catch(e) {}
      resolve();
    }
    try { a.addEventListener("ended", finish, { once: true }); } catch(e) { a.onended = finish; }
    try { a.addEventListener("error", finish, { once: true }); } catch(e) {}
  });
}

async function pumpAudioQueue() {
  if (audioState.queuePlaying) return;
  audioState.queuePlaying = true;
  try {
    while (audioState.enabled && audioState.unlocked && audioState.queue && audioState.queue.length) {
      var src = audioState.queue.shift();
      if (!src) continue;
      var a = audioState.cache[src];
      if (!a) {
        try {
          a = new Audio(src);
          a.preload = "auto";
          a.load();
          audioState.cache[src] = a;
        } catch(e) { continue; }
      }
      try { a.volume = audioState.volume; } catch(e) {}
      try { a.currentTime = 0; } catch (e) {}
      try { await a.play(); } catch(e) {}
      await waitAudioEnded(a);
    }
  } finally {
    audioState.queuePlaying = false;
  }
}

function getAudioRandStateForEvent(eventId, cfg) {
  if (!audioState.rand) audioState.rand = { poolSize: RANDOM_POOL_SIZE, byEvent: {} };
  if (audioState.rand.poolSize !== RANDOM_POOL_SIZE) {
    audioState.rand.poolSize = RANDOM_POOL_SIZE;
    audioState.rand.byEvent = {};
  }
  if (!audioState.rand.byEvent[eventId]) {
    audioState.rand.byEvent[eventId] = {
      weights: new Array(RANDOM_POOL_SIZE).fill(1),
      rollCounts: new Array(RANDOM_POOL_SIZE).fill(0),
      fileCounts: {},
      plays: 0
    };
    if (cfg && cfg.files && cfg.files.length) {
      for (var i = 0; i < cfg.files.length; i++) audioState.rand.byEvent[eventId].fileCounts[String(cfg.files[i])] = 0;
    }
  }
  return audioState.rand.byEvent[eventId];
}

function audioRandStorageKey() {
  if (solo && solo.active) {
    return "mb_solo_audio_rand";           // стабильный ключ для соло
  }
  return "mb_audio_rand_" + (state.roomId || "") + "_" + (state.playerId || "") + "_" + (state.mySlot || "");
}

function saveAudioRandToStorage() {
  try {
    if (!state || !state.roomId || !state.playerId || !state.mySlot) return;
    if (!audioState || !audioState.rand) return;
    // Сохраняем только нужное (веса/счётчики) — переживает F5
    localStorage.setItem(audioRandStorageKey(), JSON.stringify({
      poolSize: RANDOM_POOL_SIZE,
      byEvent: audioState.rand.byEvent || {}
    }));
  } catch(e) {}
}

function restoreAudioRandFromStorage() {
  try {
    if (!state || !state.roomId || !state.playerId || !state.mySlot) return;
    var raw = localStorage.getItem(audioRandStorageKey());
    if (!raw) return;
    var parsed = JSON.parse(raw);
    if (!parsed || parsed.poolSize !== RANDOM_POOL_SIZE || !parsed.byEvent) return;
    audioState.rand = { poolSize: RANDOM_POOL_SIZE, byEvent: parsed.byEvent || {} };
  } catch(e) {}
}

function clearAudioRandFromStorage() {
  try {
    // удаляем по текущей сессии (если ключ сформировать нельзя — попробуем по сохранённым значениям)
    if (state && state.roomId && state.playerId && state.mySlot) {
      localStorage.removeItem(audioRandStorageKey());
      return;
    }
    var pid = localStorage.getItem("mb_playerId");
    var rid = localStorage.getItem("mb_roomId");
    var slot = localStorage.getItem("mb_mySlot");
    if (pid && rid && slot) localStorage.removeItem("mb_audio_rand_" + rid + "_" + pid + "_" + slot);
  } catch(e) {}
}

function weightedPickIndex(weights) {
  var total = 0;
  for (var i = 0; i < weights.length; i++) total += weights[i];
  var r = Math.random() * total;
  for (var j = 0; j < weights.length; j++) {
    r -= weights[j];
    if (r <= 0) return j;
  }
  return weights.length - 1;
}

function setSoundEnabled(enabled) {
  audioState.enabled = !!enabled;
  localStorage.setItem("mb_sound_enabled", audioState.enabled ? "1" : "0");
  updateSoundButton();
}

function updateSoundButton() {
  var btn = document.getElementById("btnSound");
  if (!btn) return;
  btn.textContent = (audioState.enabled ? "🔊" : "🔇") + " " + (audioState.enabled ? "ВКЛ" : "ВЫКЛ");
}

function toggleSound() {
  setSoundEnabled(!audioState.enabled);
}

function unlockAudioOnce() {
  audioState.unlocked = true;
  // Лёгкая предзагрузка самых частых/существующих звуков (уменьшает задержки на некоторых браузерах)
  preloadAudioForEventIds(["shoot","gameStart","gameWin","gameLose"]);
}

document.addEventListener("pointerdown", unlockAudioOnce, { once: true, passive: true });
document.addEventListener("keydown", unlockAudioOnce, { once: true });

function getAudioEventConfig(id) {
  for (var i = 0; i < AUDIO_EVENTS.length; i++) if (AUDIO_EVENTS[i].id === id) return AUDIO_EVENTS[i];
  return null;
}

function preloadAudioForEventIds(ids) {
  if (!ids || !ids.length) return;
  ids.forEach(function(id) {
    var cfg = getAudioEventConfig(id);
    if (!cfg || !cfg.folder || !cfg.files) return;
    for (var i = 0; i < cfg.files.length; i++) {
      var file = cfg.files[i];
      var src = cfg.folder.replace(/\\/g, "/").replace(/\/+$/g, "") + "/" + String(file);
      if (audioState.cache[src]) continue;
      try {
        var a = new Audio(src);
        a.preload = "auto";
        a.load();
        audioState.cache[src] = a;
      } catch (e) {}
    }
  });
}

function setAudioLoadingOverlay(visible, text) {
  var overlay = document.getElementById("audioLoadingOverlay");
  var label = document.getElementById("audioLoadingText");
  if (label && text) label.textContent = text;
  if (!overlay) return;
  overlay.classList.toggle("show", !!visible);
}

function buildAllAudioSrcList() {
  var list = [];
  for (var i = 0; i < AUDIO_EVENTS.length; i++) {
    var cfg = AUDIO_EVENTS[i];
    if (!cfg || !cfg.folder || !cfg.files) continue;
    var folder = cfg.folder.replace(/\\/g, "/").replace(/\/+$/g, "");
    for (var j = 0; j < cfg.files.length; j++) {
      list.push(folder + "/" + String(cfg.files[j]));
    }
  }
  // uniq
  var seen = {};
  var out = [];
  for (var k = 0; k < list.length; k++) {
    var s = list[k];
    if (seen[s]) continue;
    seen[s] = true;
    out.push(s);
  }
  return out;
}

function pickRandom(arr) {
  if (!arr || !arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildPrioritizedAudioSrcList() {
  // Фаза 1: по 2 случайных файла из каждой категории
  // Фаза 2: оставшиеся — round-robin по 5 файлов из каждой категории
  var seen = {};
  var phase1 = [];
  var categoryRests = []; // массив остатков для каждой категории

  for (var i = 0; i < AUDIO_EVENTS.length; i++) {
    var cfg = AUDIO_EVENTS[i];
    if (!cfg || !cfg.folder || !cfg.files || !cfg.files.length) { categoryRests.push([]); continue; }
    var folder = cfg.folder.replace(/\\/g, "/").replace(/\/+$/g, "");

    // Перемешиваем файлы категории случайно
    var shuffled = cfg.files.slice();
    for (var s = shuffled.length - 1; s > 0; s--) {
      var rnd = Math.floor(Math.random() * (s + 1));
      var tmp = shuffled[s]; shuffled[s] = shuffled[rnd]; shuffled[rnd] = tmp;
    }

    // Берём первые 2 в phase1
    var restStart = 0;
    for (var k = 0; k < Math.min(2, shuffled.length); k++) {
      var src = folder + "/" + String(shuffled[k]);
      if (!seen[src]) { seen[src] = true; phase1.push(src); }
      restStart = k + 1;
    }

    // Остаток идёт в round-robin
    var rest = [];
    for (var r = restStart; r < shuffled.length; r++) {
      var src2 = folder + "/" + String(shuffled[r]);
      if (!seen[src2]) rest.push({ src: src2, folder: folder });
    }
    categoryRests.push(rest);
  }

  // Round-robin: берём по 5 из каждой категории по кругу
  var phase2 = [];
  var hasMore = true;
  var positions = categoryRests.map(function() { return 0; });
  while (hasMore) {
    hasMore = false;
    for (var ci = 0; ci < categoryRests.length; ci++) {
      var cat = categoryRests[ci];
      var pos = positions[ci];
      var end = Math.min(pos + 5, cat.length);
      for (var fi = pos; fi < end; fi++) {
        var entry = cat[fi];
        if (!seen[entry.src]) { seen[entry.src] = true; phase2.push(entry.src); }
      }
      positions[ci] = end;
      if (end < cat.length) hasMore = true;
    }
  }

  var out = phase1.concat(phase2);
  out._primeCount = phase1.length;
  return out;
}

function prettyAudioName(src) {
  try {
    var s = String(src || "");
    return s.length > 44 ? ("…" + s.slice(-43)) : s;
  } catch (e) {
    return "";
  }
}

// ── CACHE STORAGE + SERVICE WORKER (переживает F5) ─────────────
var AUDIO_CACHE_NAME = "mb-audio-cache-v1";

function isCacheStorageAvailable() {
  try { return !!(window.caches && window.caches.open); } catch (e) { return false; }
}

function isFileProtocol() {
  try { return (location && location.protocol === "file:"); } catch (e) { return false; }
}

function toAbsoluteUrl(pathOrUrl) {
  try { return new URL(String(pathOrUrl), location.href).href; } catch (e) { return String(pathOrUrl || ""); }
}

async function registerAudioServiceWorker() {
  if (isFileProtocol()) return;
  if (!("serviceWorker" in navigator)) return;
  try {
    // sw.js лежит в папке scripts → scope тоже должен быть внутри /scripts/
    await navigator.serviceWorker.register("./scripts/audio_engine/sw.js", {
      scope: "./scripts/audio_engine/"          // ← вот это главное исправление
    });
    console.log("✅ Service Worker зарегистрирован (scope: ./scripts/)");
  } catch (e) {
    console.warn("⚠️ Не удалось зарегистрировать Service Worker:", e);
  }
}

async function getAudioCacheUrlSet() {
  if (!isCacheStorageAvailable()) return new Set();
  if (isFileProtocol()) return new Set();
  try {
    var cache = await caches.open(AUDIO_CACHE_NAME);
    var keys = await cache.keys();
    var set = new Set();
    keys.forEach(function(req) { try { set.add(req.url); } catch (e) {} });
    return set;
  } catch (e) {
    return new Set();
  }
}

async function getAudioCacheStatus() {
  var total = buildAllAudioSrcList().length;
  if (!isCacheStorageAvailable()) return { total: total, cached: 0 };
  if (isFileProtocol()) return { total: total, cached: 0 };
  var set = await getAudioCacheUrlSet();
  var cached = 0;
  var list = buildAllAudioSrcList();
  for (var i = 0; i < list.length; i++) {
    if (set.has(toAbsoluteUrl(list[i]))) cached++;
  }
  return { total: total, cached: cached };
}

async function updateCacheButtons() {
  var btns = document.querySelectorAll('[data-role="btnCache"]');
  if (!btns || !btns.length) return;

  var icon = "🟥";
  try {
    if (!isFileProtocol()) {
      var st  = await getAudioCacheStatus();
      if (st.cached >= st.total) {
        icon = "🟩";
      } else {
        // Проверяем: в каждой категории есть хотя бы 2 файла
        var cachedSet = await getAudioCacheUrlSet();
        var allReady  = true;
        for (var i = 0; i < AUDIO_EVENTS.length; i++) {
          var count = getCachedCountForEvent(AUDIO_EVENTS[i], cachedSet);
          if (count < 2) { allReady = false; break; }
        }
        icon = allReady ? "🟨" : "🟥";
      }
    }
  } catch(e) {}

  btns.forEach(function(btn) {
    btn.textContent = icon + " Кэш";
  });
}

async function cacheAudioFilesToCacheStorage(opts) {
  var overwrite    = !!(opts && opts.overwrite);
  var onlyMissing  = (opts && typeof opts.onlyMissing === "boolean") ? opts.onlyMissing : true;
  var timeoutMs    = (opts && opts.timeoutMs) || 20000;
  var concurrency  = 12;

  if (!isCacheStorageAvailable()) return;
  if (isFileProtocol()) return;

  if (overwrite) {
    try { await caches.delete(AUDIO_CACHE_NAME); } catch (e) {}
  }

  var existing = onlyMissing ? await getAudioCacheUrlSet() : new Set();
  var cache    = await caches.open(AUDIO_CACHE_NAME);
  var srcs     = buildPrioritizedAudioSrcList();
  var primeCount = srcs && typeof srcs._primeCount === "number" ? srcs._primeCount : 0;

  audioState.preload.started  = true;
  audioState.preload.done     = false;
  audioState.preload.promise  = null;
  audioState.preload.total    = srcs.length;
  audioState.preload.finished = 0;
  audioState.preload.currentSrc = null;
  audioState.preload.phase    = "prime";

  // Вспомогательная функция загрузки одного файла
  async function fetchOne(rel, idx) {
    var abs = toAbsoluteUrl(rel);
    audioState.preload.currentSrc = rel;
    audioState.preload.phase = (idx < primeCount ? "prime" : "rest");

    if (onlyMissing && existing.has(abs)) {
      audioState.preload.finished++;
      return;
    }
    try {
      var ctrl = ("AbortController" in window) ? new AbortController() : null;
      var t = setTimeout(function() { try { if (ctrl) ctrl.abort(); } catch(e) {} }, timeoutMs);
      var res = await fetch(abs, { signal: ctrl ? ctrl.signal : undefined, cache: overwrite ? "reload" : "default" });
      clearTimeout(t);
      if (res && res.ok) {
        try { await cache.put(abs, res.clone()); } catch(e) {}
      }
    } catch(e) {}
    audioState.preload.finished++;
  }

  // Параллельная загрузка с ограничением concurrency
  var idx = 0;
  async function worker() {
    while (idx < srcs.length) {
      var i = idx++;
      await fetchOne(srcs[i], i);
    }
  }
  var workers = [];
  for (var w = 0; w < concurrency; w++) workers.push(worker());
  await Promise.all(workers);

  audioState.preload.currentSrc = null;
  audioState.preload.done = true;
  await updateCacheButtons();
}

// Fallback (file://): sequential in-memory preload via <audio>
function loadOneAudioSrcInMemory(src, timeoutMs) {
  return new Promise(function(resolve) {
    var a = audioState.cache[src];
    if (!a) {
      try {
        a = new Audio(src);
        a.preload = "auto";
        audioState.cache[src] = a;
      } catch (e) {
        resolve({ src: src, ok: false });
        return;
      }
    }

    var done = false;
    function finish(ok) {
      if (done) return;
      done = true;
      resolve({ src: src, ok: !!ok });
    }

    try {
      a.addEventListener("canplaythrough", function() { finish(true); }, { once: true });
      a.addEventListener("loadeddata",     function() { finish(true); }, { once: true });
      a.addEventListener("error",          function() { finish(false); }, { once: true });
      a.load();
    } catch (e) {
      finish(false);
      return;
    }

    setTimeout(function() { finish(false); }, timeoutMs || 8000);
  });
}

function preloadAllAudioInMemory(opts) {
  if (audioState.preload.promise) return audioState.preload.promise;
  var timeoutMs  = (opts && opts.timeoutMs) || 8000;
  var concurrency = 12;

  var srcs       = buildPrioritizedAudioSrcList();
  var primeCount = srcs && typeof srcs._primeCount === "number" ? srcs._primeCount : 0;

  audioState.preload.started  = true;
  audioState.preload.done     = false;
  audioState.preload.promise  = null;
  audioState.preload.total    = srcs.length;
  audioState.preload.finished = 0;
  audioState.preload.currentSrc = null;
  audioState.preload.phase    = "prime";

  audioState.preload.promise = (async function() {
    var idx = 0;
    async function worker() {
      while (idx < srcs.length) {
        var i   = idx++;
        var src = srcs[i];
        audioState.preload.currentSrc = src;
        audioState.preload.phase = (i < primeCount ? "prime" : "rest");
        await loadOneAudioSrcInMemory(src, timeoutMs);
        audioState.preload.finished++;
      }
    }
    var workers = [];
    for (var w = 0; w < concurrency; w++) workers.push(worker());
    await Promise.all(workers);
    audioState.preload.currentSrc = null;
    audioState.preload.done = true;
  })();

  return audioState.preload.promise;
}

function preloadAllAudioToCache(opts) {
  if (audioState.preload.promise) return audioState.preload.promise;

  // Показываем индикатор — он сам скроется когда загрузка завершится
  setAudioLoadingOverlay(true, "аудио 0%");
  var _indicatorTimer = setInterval(function() {
    var total = audioState.preload.total || 0;
    var fin   = audioState.preload.finished || 0;
    var pct   = total > 0 ? Math.round(fin / total * 100) : 0;
    setAudioLoadingOverlay(true, "аудио " + pct + "%");
  }, 120);

  var promise;
  if (isFileProtocol()) {
    promise = preloadAllAudioInMemory({ timeoutMs: (opts && opts.timeoutMs) || 8000 });
  } else {
    promise = cacheAudioFilesToCacheStorage({
      overwrite: !!(opts && opts.overwrite),
      onlyMissing: (opts && typeof opts.onlyMissing === "boolean") ? opts.onlyMissing : true,
      timeoutMs: (opts && opts.timeoutMs) || 20000
    });
  }

  audioState.preload.promise = promise.then(function() {
    clearInterval(_indicatorTimer);
    setAudioLoadingOverlay(false);
  }, function() {
    clearInterval(_indicatorTimer);
    setAudioLoadingOverlay(false);
  });

  return audioState.preload.promise;
}

async function ensureAudioReadyBeforeGame() {
  if (audioState.preload.done) return;

  setAudioLoadingOverlay(true, "Загрузка 0/" + (audioState.preload.total || buildAllAudioSrcList().length));
  var timer = setInterval(function() {
    var total = audioState.preload.total || 0;
    var fin = audioState.preload.finished || 0;
    var pct = total > 0 ? Math.round(fin / total * 100) : 0;
    setAudioLoadingOverlay(true, "аудио " + pct + "%");
  }, 120);

  try {
    await preloadAllAudioToCache();
  } finally {
    clearInterval(timer);
    setAudioLoadingOverlay(false);
  }
}

function playEventSound(id) {
  if (!audioState.enabled) return;
  if (!audioState.unlocked) return;

  var cfg = getAudioEventConfig(id);
  if (!cfg || !cfg.folder || !cfg.files || !cfg.files.length) return;

  var rs = getAudioRandStateForEvent(id, cfg);
  var poolRoll = weightedPickIndex(rs.weights); // 0..RANDOM_POOL_SIZE-1
  rs.rollCounts[poolRoll] = (rs.rollCounts[poolRoll] || 0) + 1;
  rs.weights[poolRoll] = (rs.weights[poolRoll] || 1) * 0.5; // 1 → 0.5 → 0.25 ...
  rs.plays = (rs.plays || 0) + 1;

  var file = cfg.files[poolRoll % cfg.files.length];
  var fileKey = String(file);
  if (rs.fileCounts[fileKey] == null) rs.fileCounts[fileKey] = 0;
  rs.fileCounts[fileKey] += 1;
  var src = cfg.folder.replace(/\\/g, "/").replace(/\/+$/g, "") + "/" + String(file);
  // сохраняем изменившиеся веса/счётчики (переживает F5)
  saveAudioRandToStorage();

  // ── ИСПРАВЛЕНИЕ ОЧЕРЕДИ ─────────────────────────────────────
  // Только текущее (уже играет) + САМОЕ ПОСЛЕДНЕЕ событие.
  // Все промежуточные звуки автоматически отбрасываются.
  if (audioState.queue.length > 0) {
    audioState.queue[audioState.queue.length - 1] = src; // заменяем последнее
  } else {
    audioState.queue.push(src);
  }

  pumpAudioQueue();


  // Если окно вероятностей открыто — обновим его "на лету"
  try {
    var overlay = document.getElementById("audioProbOverlay");
    if (overlay && overlay.classList.contains("show")) renderAudioProbabilities();
  } catch(e) {}
}

// ── ДИАГНОСТИКА АУДИО-КЭША ───────────────────────────────────

function getCachedCountForEvent(cfg, cachedUrlSet) {
  if (!cfg || !cfg.folder || !cfg.files) return 0;
  var folder = cfg.folder.replace(/\\/g, "/").replace(/\/+$/g, "");
  var count = 0;
  for (var i = 0; i < cfg.files.length; i++) {
    var src = folder + "/" + String(cfg.files[i]);
    var abs = toAbsoluteUrl(src);
    if (cachedUrlSet && cachedUrlSet.has(abs)) count++;
  }
  return count;
}

async function renderAudioDebugTable() {
  var tbody = document.getElementById("audioDebugTableBody");
  var totalEl = document.getElementById("audioDebugTotal");
  var poolEl = document.getElementById("debugPoolSize");
  var nowEl = document.getElementById("audioDebugNow");
  if (!tbody) return;
  if (poolEl) poolEl.textContent = RANDOM_POOL_SIZE;

  var cachedSet = isFileProtocol() ? null : await getAudioCacheUrlSet();
  var totalExpected = 0, totalLoaded = 0;
  var html = "";

  for (var i = 0; i < AUDIO_EVENTS.length; i++) {
    var cfg = AUDIO_EVENTS[i];
    var expected = cfg.files ? cfg.files.length : 0;
    var loaded = isFileProtocol() ? 0 : getCachedCountForEvent(cfg, cachedSet);
    totalExpected += expected;
    totalLoaded += loaded;

    var pct = expected > 0 ? Math.round((loaded / expected) * 100) : 0;
    var barClass = pct === 100 ? "full" : pct > 0 ? "partial" : "empty";
    var countClass = pct === 100 ? "ok" : pct > 0 ? "warn" : "bad";

    html += "<tr>";
    html += "<td>" + (cfg.label || cfg.id) + "</td>";
    html += "<td style='color:rgba(168,228,255,0.5);'>" + expected + "</td>";
    html += "<td><span class='audio-debug-bar-wrap'><span class='audio-debug-bar " + barClass + "' style='width:" + pct + "%'></span></span></td>";
    html += "<td><span class='audio-debug-count " + countClass + "'>" + loaded + "/" + expected + "</span></td>";
    html += "</tr>";
  }

  tbody.innerHTML = html;
  if (totalEl) totalEl.textContent = "Итого: " + totalLoaded + "/" + totalExpected + " файлов";

  if (nowEl) {
    if (audioState.preload && audioState.preload.started && !audioState.preload.done) {
      var phase = audioState.preload.phase === "prime" ? "первая волна" : "остаток";
      var cur = audioState.preload.currentSrc ? prettyAudioName(audioState.preload.currentSrc) : "—";
      nowEl.textContent = "Скачивается сейчас (" + phase + "): " + cur;
    } else if (audioState.preload && audioState.preload.done) {
      nowEl.textContent = isFileProtocol()
        ? "Готово (режим file://). Для Cache Storage откройте через http://"
        : "Скачивание завершено.";
    } else {
      nowEl.textContent = "";
    }
  }
}

function openAudioDebug() {
  renderAudioDebugTable();
  document.getElementById("audioDebugOverlay").classList.add("show");
  // Обновляем таблицу каждые 300мс пока окно открыто
  audioState._debugInterval = setInterval(function() { renderAudioDebugTable(); }, 300);
}

function closeAudioDebug() {
  document.getElementById("audioDebugOverlay").classList.remove("show");
  if (audioState._debugInterval) { clearInterval(audioState._debugInterval); audioState._debugInterval = null; }
}

function openAudioProb() {
  var sel = document.getElementById("audioProbEventSelect");
  var poolEl = document.getElementById("audioProbPoolSize");
  if (poolEl) poolEl.textContent = String(RANDOM_POOL_SIZE);
  if (sel) {
    // наполняем список событий
    var html = "";
    for (var i = 0; i < AUDIO_EVENTS.length; i++) {
      var cfg = AUDIO_EVENTS[i];
      html += "<option value='" + cfg.id + "'>" + (cfg.label || cfg.id) + " (" + (cfg.files ? cfg.files.length : 0) + ")</option>";
    }
    sel.innerHTML = html;
  }
  document.getElementById("audioProbOverlay").classList.add("show");
  renderAudioProbabilities();
  audioState._probInterval = setInterval(function() { renderAudioProbabilities(); }, 400);
}

function closeAudioProb() {
  document.getElementById("audioProbOverlay").classList.remove("show");
  if (audioState._probInterval) { clearInterval(audioState._probInterval); audioState._probInterval = null; }
}

function renderAudioProbabilities() {
  var sel = document.getElementById("audioProbEventSelect");
  var tbody = document.getElementById("audioProbTableBody");
  var meta = document.getElementById("audioProbEventMeta");
  if (!sel || !tbody) return;

  var eventId = sel.value || (AUDIO_EVENTS[0] ? AUDIO_EVENTS[0].id : "");
  var cfg = getAudioEventConfig(eventId);
  if (!cfg || !cfg.files || !cfg.files.length) { tbody.innerHTML = ""; if (meta) meta.textContent = ""; return; }

  var rs = getAudioRandStateForEvent(eventId, cfg);
  var n = cfg.files.length;

  // суммируем веса по файлам через отображение i % n
  var fileW = {};
  for (var j = 0; j < n; j++) fileW[String(cfg.files[j])] = 0;
  for (var k = 0; k < RANDOM_POOL_SIZE; k++) {
    var file = String(cfg.files[k % n]);
    fileW[file] = (fileW[file] || 0) + (rs.weights[k] || 0);
  }

  // рендер
  var maxW = 0;
  for (var m = 0; m < n; m++) {
    var fn = String(cfg.files[m]);
    if ((fileW[fn] || 0) > maxW) maxW = fileW[fn] || 0;
  }

  var rows = [];
  for (var f = 0; f < n; f++) {
    var fileName = String(cfg.files[f]);
    var w = fileW[fileName] || 0;
    // “вес 0..100”: у самых вероятных вес = 100, остальные пропорционально
    var w100 = maxW > 0 ? Math.round((w / maxW) * 100) : 0;
    var cnt = rs.fileCounts && rs.fileCounts[fileName] ? rs.fileCounts[fileName] : 0;
    rows.push({ file: fileName, w100: w100, cnt: cnt });
  }
  rows.sort(function(a,b){ return b.w100 - a.w100; });

  var html = "";
  for (var r = 0; r < rows.length; r++) {
    var item = rows[r];
    html += "<tr>";
    html += "<td style='color:rgba(168,228,255,0.85);'>" + item.file + "</td>";
    html += "<td>";
    html += "<span class='audio-debug-bar-wrap'><span class='audio-debug-bar partial' style='width:" + Math.min(100, Math.max(0, item.w100)) + "%'></span></span>";
    html += "<span class='audio-debug-count' style='margin-left:6px;color:rgba(240,192,64,0.95);font-weight:700;'>" + item.w100 + "</span>";
    html += "</td>";
    html += "<td><span class='audio-debug-count ok'>" + item.cnt + "</span></td>";
    html += "</tr>";
  }
  tbody.innerHTML = html;
  if (meta) meta.textContent = "Срабатываний: " + (rs.plays || 0);
}

function reloadAudioCache() {
  // Сбрасываем in-memory аудио и делаем полную перезапись Cache Storage
  audioState.cache = {};
  audioState.queue = [];
  audioState.queuePlaying = false;
  audioState.preload = { started: false, done: false, total: 0, finished: 0, promise: null, currentSrc: null, phase: "" };
  renderAudioDebugTable();
  preloadAllAudioToCache({ overwrite: true, onlyMissing: false });
  initWebAudio();
}
