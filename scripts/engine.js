// ── ПОЛНЫЙ ЭКРАН ──────────────────────────────────────────────
function isIphone() {
  return /iPhone/i.test(navigator.userAgent || "");
}

function isFullscreenSupported() {
  return !!(document.documentElement && document.documentElement.requestFullscreen);
}

function updateFullscreenButton() {
  var btns = document.querySelectorAll('[data-role="btnFullscreen"]');
  if (!btns || !btns.length) return;

  if (isIphone() || !isFullscreenSupported()) {
    btns.forEach(function(btn) { btn.style.display = "none"; });
    return;
  }

  btns.forEach(function(btn) {
    btn.style.display = "";
    btn.textContent = (document.fullscreenElement ? "▢" : "⛶") + "";
  });
}

function toggleFullscreen() {
  if (isIphone()) return;
  if (!isFullscreenSupported()) return;

  if (document.fullscreenElement) {
    document.exitFullscreen().catch(function(){});
  } else {
    document.documentElement.requestFullscreen().catch(function(){});
  }
}

document.addEventListener("fullscreenchange", updateFullscreenButton);

// ── СОСТОЯНИЕ ПРИЛОЖЕНИЯ ─────────────────────────────────────
var state = {
  playerId:     null,
  mySlot:       null,
  nickname:     null,
  roomId:       null,
  myBoard:      null,
  gameState:    null,
  pollTimer:    null,
  lobbyTimer:   null,
  log:          [],
  winnerShown:  false,
  inputLocked:  false,
  currentView:  "mine",
  prevTurn:     null,
  lastShotCount: { p1: 0, p2: 0 },
  lastShot:     { my: null, enemy: null }, // {x,y}
  enemyShotShowUntil: 0, // timestamp ms: держим "моё поле" до этого момента
};

var COL_LABELS = ["А","Б","В","Г","Д","Е","Ж","З","И","К"];
var ROW_LABELS = ["1","2","3","4","5","6","7","8","9","10"];

// ── API ───────────────────────────────────────────────────────
function apiPost(data) {
  return fetch(API_URL, {
    method:  "POST",
    body:    JSON.stringify(data),
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    redirect: "follow"
  }).then(function(r){ return r.json(); });
}

function apiGet(params) {
  var url = API_URL + "?action=state";
  if (params.playerId) url += "&playerId=" + encodeURIComponent(params.playerId);
  if (params.roomId)   url += "&roomId="   + encodeURIComponent(params.roomId);
  return fetch(url, { redirect: "follow" }).then(function(r){ return r.json(); });
}

function apiGetRooms() {
  return fetch(API_URL + "?action=getRooms", { redirect: "follow" }).then(function(r){ return r.json(); });
}

// ── СЕССИЯ ───────────────────────────────────────────────────
function saveSession() {
  localStorage.setItem("mb_playerId", state.playerId);
  localStorage.setItem("mb_nickname", state.nickname);
  localStorage.setItem("mb_mySlot",   state.mySlot);
  localStorage.setItem("mb_roomId",   state.roomId);
}
function loadSession() {
  state.playerId = localStorage.getItem("mb_playerId");
  state.nickname = localStorage.getItem("mb_nickname");
  state.mySlot   = parseInt(localStorage.getItem("mb_mySlot")) || null;
  state.roomId   = localStorage.getItem("mb_roomId");
  return !!(state.playerId && state.nickname && state.roomId);
}
function clearSession() {
  // Сбрасываем сохранённые вероятности звуков при выходе/смене комнаты
  clearAudioRandFromStorage();
  ["mb_playerId","mb_nickname","mb_mySlot","mb_roomId"].forEach(function(k){ localStorage.removeItem(k); });
  state.playerId = null; state.nickname = null; state.mySlot = null; state.roomId = null;
  state.myBoard  = null;
}
// Отдельно — сохранённый никнейм (не сбрасывается при выходе из игры)
function saveNickname(nick) { localStorage.setItem("mb_saved_nick", nick); }
function loadSavedNickname() { return localStorage.getItem("mb_saved_nick") || ""; }

// ── СООБЩЕНИЯ ─────────────────────────────────────────────────
function showLoginMsg(text, type) {
  document.getElementById("loginMsg").innerHTML =
    '<div class="message message-' + type + '">' + text + '</div>';
}
function showCreateMsg(text, type) {
  document.getElementById("createMsg").innerHTML =
    '<div class="message message-' + type + '">' + text + '</div>';
}

// ── INPUT LOCK ────────────────────────────────────────────────
function lockInput(noticeText) {
  state.inputLocked = true;
  document.getElementById("inputLock").classList.add("active");
  document.getElementById("shootingNoticeText").textContent = noticeText || "ВЫСТРЕЛ...";
  document.getElementById("shootingNotice").classList.add("show");
}
function unlockInput() {
  state.inputLocked = false;
  document.getElementById("inputLock").classList.remove("active");
  document.getElementById("shootingNotice").classList.remove("show");
}

// ── ОБЪЯВЛЕНИЕ СМЕНЫ ХОДА ─────────────────────────────────────
function showPhaseAnnouncement(text, type) {
  return new Promise(function(resolve) {
    var el = document.getElementById("phaseAnnouncement");
    el.className = "phase-announcement " + type;
    el.textContent = text;
    void el.offsetHeight;
    el.classList.add("show");
    setTimeout(function() {
      el.classList.add("hide");
      el.classList.remove("show");
      setTimeout(function() { el.className = "phase-announcement"; resolve(); }, 220);
    }, 900);
  });
}

function sleepMs(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, Math.max(0, ms || 0)); });
}

// ── ЭКРАНЫ ───────────────────────────────────────────────────
function showScreen(name) {
  ["loginScreen","lobbyScreen","gameScreen"].forEach(function(id) {
    var el = document.getElementById(id);
    if (id === "lobbyScreen") {
      el.classList.toggle("visible", id === name);
      el.style.display = (id === name) ? "" : "none";
    } else {
      el.style.display = (id === name) ? (id === "loginScreen" ? "flex" : "block") : "none";
    }
  });
}

// ── ШАГ 1: ПЕРЕХОД В ЛОББИ ────────────────────────────────────
function goToLobby() {
  var nickname = document.getElementById("inNickname").value.trim();
  if (!nickname) { showLoginMsg("Введите никнейм", "error"); return; }
  state.nickname = nickname;
  saveNickname(nickname);
  document.getElementById("loginMsg").innerHTML = "";
  document.getElementById("lobbyNickname").textContent = nickname;
  document.getElementById("createMsg").innerHTML = "";
  showScreen("lobbyScreen");
  startLobbyPolling();
}

function backToLogin() {
  stopLobbyPolling();
  showScreen("loginScreen");
}

// ── ЛОББИ: СПИСОК КОМНАТ ──────────────────────────────────────
var lobbyCountdown = 3;
var lobbyCountdownTimer = null;

function startLobbyPolling() {
   loadRooms();
   state.lobbyTimer = setInterval(function() {
     loadRooms();
   }, LOBBY_INTERVAL);
}

function stopLobbyPolling() {
   if (state.lobbyTimer) { clearInterval(state.lobbyTimer); state.lobbyTimer = null; }
   if (lobbyCountdownTimer) { clearInterval(lobbyCountdownTimer); lobbyCountdownTimer = null; }
}

function startLobbyCountdown() {
   lobbyCountdown = Math.ceil(LOBBY_INTERVAL / 1000);
   if (lobbyCountdownTimer) clearInterval(lobbyCountdownTimer);
   
   lobbyCountdownTimer = setInterval(function() {
     lobbyCountdown--;
     var el = document.getElementById("roomsTimer");
     if (el) el.textContent = "обновление через " + Math.max(0, lobbyCountdown) + "с";
   }, 1000);
}

async function loadRooms() {
   var el = document.getElementById("roomsTimer");
   if (el) el.textContent = "загрузка...";
   try {
     var res = await apiGetRooms();
     if (!res.ok) return;
     renderRooms(res.rooms || []);
   } catch(e) {
     document.getElementById("roomsList").innerHTML =
       '<div class="rooms-empty"><span class="icon">⚠</span>Ошибка подключения</div>';
   }
   startLobbyCountdown();
}

function renderRooms(rooms) {
  var list = document.getElementById("roomsList");
  if (!rooms.length) {
    list.innerHTML = '<div class="rooms-empty"><span class="icon">🌊</span>Нет открытых комнат.<br>Создайте свою!</div>';
    return;
  }
  rooms.sort(function(a, b) { return (a.idleSec || 0) - (b.idleSec || 0); });
  var html = "";
  rooms.forEach(function(r) {
    var idle = r.idleSec || 0;
    var idleText, idleClass;
    if (idle < 60) {
      idleText  = idle + " сек назад";
      idleClass = "fresh";
    } else if (idle < 300) {
      idleText  = Math.floor(idle / 60) + " мин назад";
      idleClass = "medium";
    } else {
      idleText  = Math.floor(idle / 60) + " мин назад";
      idleClass = "stale";
    }
    html += '<div class="room-item">' +
      '<div class="room-info">' +
        '<div class="room-name">⚓ ' + escapeHtml(r.player1Nick) + '</div>' +
        '<div class="room-meta">' +
          '<span class="room-id">КОД: ' + r.roomId + '</span>' +
          '<span class="room-idle ' + idleClass + '">⏱ ' + idleText + '</span>' +
        '</div>' +
      '</div>' +
      '<button class="btn btn-primary btn-sm" style="width:auto;flex-shrink:0;" onclick="joinRoom(\'' + r.roomId + '\')">ВОЙТИ</button>' +
    '</div>';
  });
  list.innerHTML = html;
}

function escapeHtml(str) {
  return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

var _appToastHideTimer = null;
function showAppToast(message, variant, durationMs) {
  variant = variant || "info";
  durationMs = durationMs != null ? durationMs : (variant === "error" ? 5200 : 3800);
  var root = document.getElementById("appToastRoot");
  if (!root) return;
  root.innerHTML = "";
  var el = document.createElement("div");
  el.className = "app-toast app-toast--" + variant;
  el.setAttribute("role", "status");
  el.textContent = message;
  root.appendChild(el);
  requestAnimationFrame(function () {
    el.classList.add("app-toast--visible");
  });
  clearTimeout(_appToastHideTimer);
  _appToastHideTimer = setTimeout(function () {
    el.classList.remove("app-toast--visible");
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 320);
  }, durationMs);
}

var _adminConfirmResolver = null;
function showAdminConfirm(opts) {
  opts = opts || {};
  return new Promise(function (resolve) {
    if (_adminConfirmResolver) {
      var prev = _adminConfirmResolver;
      _adminConfirmResolver = null;
      prev(false);
    }
    _adminConfirmResolver = resolve;
    var ov = document.getElementById("adminConfirmOverlay");
    if (!ov) {
      _adminConfirmResolver = null;
      resolve(false);
      return;
    }
    var titleEl = document.getElementById("adminConfirmTitle");
    var msgEl = document.getElementById("adminConfirmMessage");
    var detEl = document.getElementById("adminConfirmDetail");
    var okBtn = document.getElementById("btnAdminConfirmOk");
    var canBtn = document.getElementById("btnAdminConfirmCancel");
    if (titleEl) titleEl.textContent = opts.title || "Подтверждение";
    if (msgEl) msgEl.textContent = opts.message != null ? opts.message : "";
    if (detEl) detEl.textContent = opts.detail != null ? opts.detail : "";
    if (okBtn) okBtn.textContent = opts.confirmLabel || "Удалить";
    if (canBtn) canBtn.textContent = opts.cancelLabel || "Отмена";
    ov.classList.add("show");
    ov.setAttribute("aria-hidden", "false");
    if (okBtn) okBtn.focus();
  });
}

function closeAdminConfirm(confirmed) {
  var ov = document.getElementById("adminConfirmOverlay");
  if (ov) {
    ov.classList.remove("show");
    ov.setAttribute("aria-hidden", "true");
  }
  if (_adminConfirmResolver) {
    var r = _adminConfirmResolver;
    _adminConfirmResolver = null;
    r(!!confirmed);
  }
}

// ── СОЗДАТЬ КОМНАТУ ───────────────────────────────────────────
async function createRoom() {
  if (!state.nickname) return;
  var board = await openPlacementSetup({ context: "online", defaultMode: "random" });
  if (!board) return;
  showCreateMsg("Создание комнаты...", "info");
  try {
    var res = await apiPost({ action: "createRoom", nickname: state.nickname, shipBoard: board });
    if (!res.ok) { showCreateMsg(res.error, "error"); return; }
    state.playerId = res.playerId;
    state.mySlot   = res.slot;
    state.roomId   = res.roomId;
    saveSession();
    stopLobbyPolling();
    await enterGameScreen();
  } catch(e) { showCreateMsg("Ошибка подключения. Проверьте URL API.", "error"); }
}

// ── ВОЙТИ В КОМНАТУ ───────────────────────────────────────────
async function joinRoom(roomId) {
  if (!state.nickname) return;
  var board = await openPlacementSetup({ context: "online", defaultMode: "random" });
  if (!board) return;
  try {
    var res = await apiPost({ action: "joinRoom", nickname: state.nickname, roomId: roomId, shipBoard: board });
    if (!res.ok) {
      // Показываем ошибку в лобби
      document.getElementById("createMsg").innerHTML =
        '<div class="message message-error">' + res.error + '</div>';
      return;
    }
    state.playerId = res.playerId;
    state.mySlot   = res.slot;
    state.roomId   = res.roomId;
    saveSession();
    stopLobbyPolling();
    await enterGameScreen();
  } catch(e) {
    document.getElementById("createMsg").innerHTML =
      '<div class="message message-error">Ошибка подключения</div>';
  }
}

// ── ПЕРЕХОД В ИГРОВОЙ ЭКРАН ───────────────────────────────────
async function enterGameScreen() {
  preloadAllAudioToCache({ overwrite: false, onlyMissing: true }); // фоновая загрузка, не блокируем
  showScreen("gameScreen");
  document.getElementById("waitingRoomCode").textContent = state.roomId || "—";
  // Восстанавливаем вероятности звуков для этой комнаты/сессии (переживает F5)
  restoreAudioRandFromStorage();
  buildGridLabels();
  buildGrids();
  restoreLog();
  startPolling();
}

// ── РУЧНОЕ ПЕРЕКЛЮЧЕНИЕ ПОЛЕЙ ─────────────────────────────────
function manualSwitchView(view) {
  // Разрешаем ручное переключение всегда, кроме момента анимации
  if (state.inputLocked) return;
  switchView(view, true);
}

// ── ПЕРЕКЛЮЧЕНИЕ ВИДИМОСТИ ПОЛЕЙ ─────────────────────────────
function switchView(view, animate) {
  if (state.currentView === view && !animate) return;
  state.currentView = view;

  var myPanel     = document.getElementById("myBoardPanel");
  var enemyPanel  = document.getElementById("enemyBoardPanel");
  var myDimmed    = document.getElementById("myBoardDimmed");
  var enemyDimmed = document.getElementById("enemyBoardDimmed");
  var btnMine     = document.getElementById("btnViewMine");
  var btnEnemy    = document.getElementById("btnViewEnemy");

  if (view === "mine") {
    myPanel.style.display    = "";
    enemyPanel.style.display = "none";
    myPanel.classList.remove("active-enemy");
    myPanel.classList.add("active-mine");
    myDimmed.style.display   = "none";
    if (animate) {
      myPanel.classList.remove("board-entering-right","board-entering-left","board-leaving");
      void myPanel.offsetWidth;
      myPanel.classList.add("board-entering-left");
    }
    if (btnMine)  { btnMine.classList.add("active-mine");    btnMine.classList.remove("active-enemy"); }
    if (btnEnemy) { btnEnemy.classList.remove("active-mine","active-enemy"); }
  } else {
    myPanel.style.display    = "none";
    enemyPanel.style.display = "";
    enemyPanel.classList.remove("active-mine");
    enemyPanel.classList.add("active-enemy");
    enemyDimmed.style.display = "none";
    if (animate) {
      enemyPanel.classList.remove("board-entering-right","board-entering-left","board-leaving");
      void enemyPanel.offsetWidth;
      enemyPanel.classList.add("board-entering-right");
    }
    if (btnEnemy) { btnEnemy.classList.add("active-enemy");   btnEnemy.classList.remove("active-mine"); }
    if (btnMine)  { btnMine.classList.remove("active-mine","active-enemy"); }
  }
}

// ── БАННЕР ХОДА ───────────────────────────────────────────────
function updateTurnBadge(isMyTurn, enemyName) {
  var badge = document.getElementById("turnBadge");
  if (isMyTurn) {
    badge.className = "turn-badge my-turn";
    badge.textContent = "⚡ ВАШ ХОД";
  } else {
    badge.className = "turn-badge enemy-turn";
    badge.textContent = "⏳ ХОД: " + (enemyName || "ПРОТИВНИК");
  }
}

// ── ШКАЛА ВЕРОЯТНОСТИ ПОБЕДЫ ──────────────────────────────────
function updateWinProbability() {
  var myGrid = document.getElementById("myGrid");
  var enemyGrid = document.getElementById("enemyGrid");
  if (!myGrid || !enemyGrid) return;

  // ── Непростреленные клетки ────────────────────────────────
  var myUntouched = 0;
  myGrid.querySelectorAll(".cell").forEach(function(c) {
    var cls = c.className.trim();
    if (cls === "cell" || cls === "cell ship") myUntouched++;
  });

  var enemyUntouched = 0;
  enemyGrid.querySelectorAll(".cell").forEach(function(c) {
    var cls = c.className;
    if (cls.indexOf("hit") === -1 && cls.indexOf("miss") === -1 && cls.indexOf("sunk") === -1) {
      enemyUntouched++;
    }
  });

  // ── Бонус за потопленные корабли ─────────────────────────
  // 1-палубный +4, 2-палубный +2, 3-палубный +3, 4-палубный +1
  var sunkBonus = { 1: 4, 2: 2, 3: 3, 4: 1 };

  function calcSunkBonus(shots) {
    if (!shots) return 0;
    var bonus = 0;
    shots.forEach(function(s) {
      if (s.result === "sunk" && s.sunkCells) {
        var size = s.sunkCells.length;
        bonus += (sunkBonus[size] || 0);
      }
    });
    return bonus;
  }

  var gs = state.gameState;
  var myShots    = gs ? (state.mySlot === 1 ? gs.shotsP1 : gs.shotsP2) : null;
  var enemyShots = gs ? (state.mySlot === 1 ? gs.shotsP2 : gs.shotsP1) : null;

  // В соло-режиме — берём из solo.shots
  if (solo && solo.active) {
    myShots    = solo.shots    || [];
    enemyShots = solo.aiShots  || [];
  }

  var playerBonus = calcSunkBonus(myShots);    // мы потопили вражеские корабли
  var enemyBonus  = calcSunkBonus(enemyShots); // враг потопил наши корабли

  // ── Итоговый счёт ─────────────────────────────────────────
  // База: непростреленные клетки. Чем больше у тебя — тем лучше.
  // Бонус за потопленные добавляется к своей стороне.
  var playerScore = myUntouched + playerBonus;
  var enemyScore  = enemyUntouched + enemyBonus;
  var total = playerScore + enemyScore;

  var playerPct, enemyPct;
  if (total === 0) {
    playerPct = 50; enemyPct = 50;
  } else {
    playerPct = Math.round(playerScore / total * 100);
    enemyPct  = 100 - playerPct;
  }

  var fillPlayer = document.getElementById("winProbFillPlayer");
  var fillEnemy  = document.getElementById("winProbFillEnemy");
  var divider    = document.getElementById("winProbDivider");
  var pctPlayer  = document.getElementById("winProbPctPlayer");
  var pctEnemy   = document.getElementById("winProbPctEnemy");
  if (!fillPlayer) return;

  fillPlayer.style.width = playerPct + "%";
  fillEnemy.style.width  = enemyPct + "%";
  divider.style.left     = playerPct + "%";
  pctPlayer.textContent  = playerPct + "%";
  pctEnemy.textContent   = enemyPct + "%";
}

// ── ПОСТРОЕНИЕ МЕТОК СЕТКИ ────────────────────────────────────
function buildGridLabels() {
  ["myLabelsRow","enemyLabelsRow"].forEach(function(id) {
    var el = document.getElementById(id); el.innerHTML = "";
    COL_LABELS.forEach(function(l) {
      var d = document.createElement("div"); d.className = "grid-label"; d.textContent = l; el.appendChild(d);
    });
  });
  ["myLabelsCol","enemyLabelsCol"].forEach(function(id) {
    var el = document.getElementById(id); el.innerHTML = "";
    ROW_LABELS.forEach(function(l) {
      var d = document.createElement("div"); d.className = "grid-label-side"; d.textContent = l; el.appendChild(d);
    });
  });
}

function buildGrids() {
  buildGrid("myGrid", false);
  buildGrid("enemyGrid", true);
  setupEnemyGridClickHandler();        // ←←← обязательно
}

function buildGrid(gridId, isEnemy) {
  var el = document.getElementById(gridId);
  el.innerHTML = "";
  
  for (var r = 0; r < 10; r++) {
    for (var c = 0; c < 10; c++) {
      var cell = document.createElement("div");
      cell.className = "cell" + (isEnemy ? " enemy-cell" : "");
      cell.dataset.x = c;
      cell.dataset.y = r;
      el.appendChild(cell);
    }
  }
}

// ── НАДЁЖНЫЙ ДЕЛЕГАЦИОННЫЙ ОБРАБОТЧИК КЛИКОВ ПО ПОЛЮ ПРОТИВНИКА ──
function setupEnemyGridClickHandler() {
  var grid = document.getElementById("enemyGrid");
  if (!grid) return;

  // Удаляем старый обработчик, чтобы не было дублей
  if (grid._hasClickHandler) grid.removeEventListener("click", grid._clickHandler);

  grid._clickHandler = function(e) {
    var cell = e.target.closest(".cell.enemy-cell");
    if (!cell) return;

    var x = parseInt(cell.dataset.x);
    var y = parseInt(cell.dataset.y);

    if (isNaN(x) || isNaN(y)) return;
    if (!cell.classList.contains("shootable")) return;

    console.log(`🎯 Клик по клетке противника: (${x},${y})`);

    if (solo && solo.active) {
      soloShoot(x, y);
    } else {
      shoot(x, y);
    }
  };

  grid.addEventListener("click", grid._clickHandler, true);
  grid._hasClickHandler = true;
  console.log("✅ Delegation handler для enemyGrid установлен");
}

// ── ВЫСТРЕЛ ───────────────────────────────────────────────────
async function shoot(x, y) {
  if (state.inputLocked) return;
  var gs = state.gameState;
  if (!gs || gs.phase !== "playing") return;
  if (gs.turn !== state.playerId) return;

  // Доп. защита: даже если вызвали shoot() напрямую, стреляем только по shootable.
  var targetCell = getEnemyCellElement(x, y);
  if (!targetCell || !targetCell.classList.contains("shootable")) return;

  audioState.lastPlayerShotAt = Date.now();
  playEventSound("shoot");

  var myShots = state.mySlot === 1 ? gs.shotsP1 : gs.shotsP2;
  for (var i = 0; i < myShots.length; i++) {
    if (myShots[i].x === x && myShots[i].y === y) return;
  }

  lockInput("ПРИЦЕЛИВАНИЕ...");
  setEnemyGridShootable(false);
  state.lastShot.my = { x: x, y: y };

  try {
    var apiPromise = apiPost({ action: "move", playerId: state.playerId, roomId: state.roomId, x: x, y: y });
    document.getElementById("shootingNoticeText").textContent = "ВЫСТРЕЛ!";
    await animateProjectile(targetCell);

    document.getElementById("shootingNoticeText").textContent = "ОЖИДАНИЕ РЕЗУЛЬТАТА...";
    var res = await apiPromise;

    if (!res.ok) {
      addLog("Ошибка: " + res.error, "miss");
      if (isRoomMissingErrorMessage(res.error)) {
        handleRoomMissingFromServer(res.error);
      }
      return;
    }

    var result = res.result || "miss";

    // Для попадания: вычисляем угловые клетки на стороне клиента
    if (result === "hit" && !res.hitCorners) {
      var corners = [[-1,-1],[1,-1],[-1,1],[1,1]];
      var myShots2 = state.mySlot === 1 ? state.gameState.shotsP1 : state.gameState.shotsP2;
      var shotSet2 = {};
      myShots2.forEach(function(s){ shotSet2[s.y+"_"+s.x] = true; });
      shotSet2[y+"_"+x] = true;
      var computedCorners = [];
      corners.forEach(function(d) {
        var nx = x + d[0], ny = y + d[1];
        var k = ny + "_" + nx;
        if (nx >= 0 && nx <= 9 && ny >= 0 && ny <= 9 && !shotSet2[k]) {
          computedCorners.push({ x: nx, y: ny });
        }
      });
      if (computedCorners.length) res.hitCorners = computedCorners;
    }

    await playImpactEffect(targetCell, result);

    if (res.gameOver) {
      fetchState();
    } else {
      applyLocalShot(x, y, result, res);
      await handleTurnTransition(result, res);
    }

  } catch(e) {
    console.error("Ошибка выстрела:", e);
    addLog("Ошибка выстрела. Проверьте соединение.", "miss");
    // Синхронизируем состояние с сервером, чтобы корректно восстановить ход
    try { await fetchState(); } catch(e2) {}
  } finally {
    unlockInput();
    // Если ход всё ещё наш — вернём кликабельность
    try {
      var _gs = state.gameState;
      if (_gs && _gs.phase === "playing" && _gs.turn === state.playerId) setEnemyGridShootable(true);
    } catch(e) {}
  }
}

function getEnemyCellElement(x, y) {
  return document.querySelector('#enemyGrid .cell[data-x="' + x + '"][data-y="' + y + '"]');
}
function getMyCellElement(x, y) {
  return document.querySelector('#myGrid .cell[data-x="' + x + '"][data-y="' + y + '"]');
}

// ── АНИМАЦИЯ СНАРЯДА ──────────────────────────────────────────
function animateProjectile(targetCell) {
  return new Promise(function(resolve) {
    var canvas = document.getElementById("projectileCanvas");
    var ctx    = canvas.getContext("2d");
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;

    if (!targetCell) { resolve(); return; }

    var badge = document.getElementById("turnBadge");
    var startRect = badge.getBoundingClientRect();
    var sx = startRect.left + startRect.width  / 2;
    var sy = startRect.top  + startRect.height / 2;

    var endRect = targetCell.getBoundingClientRect();
    var ex = endRect.left + endRect.width  / 2;
    var ey = endRect.top  + endRect.height / 2;

    var cpx = (sx + ex) / 2;
    var cpy = Math.min(sy, ey) - Math.max(80, Math.abs(ey - sy) * 0.45);

    var DURATION = 380;
    var start = null;
    var history = [];
    var TRAIL_LEN = 14;

    function bezier(t, p0, p1, p2) {
      var m = 1 - t; return m * m * p0 + 2 * m * t * p1 + t * t * p2;
    }
    function tangentAngle(t) {
      var dt = 0.01, t2 = Math.min(t + dt, 1);
      var dx = bezier(t2,sx,cpx,ex) - bezier(t,sx,cpx,ex);
      var dy = bezier(t2,sy,cpy,ey) - bezier(t,sy,cpy,ey);
      return Math.atan2(dy, dx);
    }

    function frame(ts) {
      if (!start) start = ts;
      var t  = Math.min((ts - start) / DURATION, 1);
      var cx = bezier(t,sx,cpx,ex);
      var cy = bezier(t,sy,cpy,ey);
      var angle = tangentAngle(t);

      history.push({ x: cx, y: cy });
      if (history.length > TRAIL_LEN) history.shift();

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (history.length > 1) {
        for (var i = 1; i < history.length; i++) {
          var frac = i / history.length;
          ctx.beginPath();
          ctx.moveTo(history[i-1].x, history[i-1].y);
          ctx.lineTo(history[i].x, history[i].y);
          ctx.strokeStyle = "rgba(180,220,255," + (frac * 0.65) + ")";
          ctx.lineWidth   = frac * 2.5;
          ctx.lineCap     = "round";
          ctx.stroke();
        }
      }

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      var bLen = 9, bRad = 2.5;
      var grad = ctx.createLinearGradient(-bLen, 0, bLen, 0);
      grad.addColorStop(0,   "rgba(140,200,255,0)");
      grad.addColorStop(0.3, "rgba(200,230,255,0.7)");
      grad.addColorStop(0.7, "rgba(255,255,255,1)");
      grad.addColorStop(1,   "rgba(255,255,255,0.9)");
      ctx.beginPath();
      ctx.ellipse(0, 0, bLen, bRad, 0, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(bLen - 1, 0, bRad * 0.7, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,1)";
      ctx.fill();
      ctx.restore();

      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        var gr = ctx.createRadialGradient(ex, ey, 0, ex, ey, 18);
        gr.addColorStop(0, "rgba(255,255,255,0.9)");
        gr.addColorStop(0.4, "rgba(180,220,255,0.5)");
        gr.addColorStop(1, "rgba(100,160,255,0)");
        ctx.beginPath();
        ctx.arc(ex, ey, 18, 0, Math.PI * 2);
        ctx.fillStyle = gr;
        ctx.fill();
        setTimeout(function() { ctx.clearRect(0, 0, canvas.width, canvas.height); resolve(); }, 80);
      }
    }
    requestAnimationFrame(frame);
  });
}

// ── ЭФФЕКТ ПОПАДАНИЯ/ПРОМАХА ──────────────────────────────────
function playImpactEffect(cell, result) {
  return new Promise(function(resolve) {
    if (!cell) { resolve(); return; }
    if (result === "hit" || result === "sunk") {
      var fx = document.createElement("div");
      fx.className = "fx-explosion";
      cell.appendChild(fx);
      var panel = document.getElementById("enemyBoardPanel");
      panel.classList.remove("board-shake"); void panel.offsetWidth; panel.classList.add("board-shake");
      setTimeout(function() { if (fx.parentNode) fx.parentNode.removeChild(fx); panel.classList.remove("board-shake"); resolve(); }, 500);
    } else {
      var fx = document.createElement("div");
      fx.className = "fx-splash";
      cell.appendChild(fx);
      setTimeout(function() { if (fx.parentNode) fx.parentNode.removeChild(fx); resolve(); }, 600);
    }
  });
}

// ── ЭФФЕКТ ВХОДЯЩЕГО ВЫСТРЕЛА (ПО НАМ) ────────────────────────
function playIncomingImpactEffect(cell, result) {
  return new Promise(function(resolve) {
    if (!cell) { resolve(); return; }

    // Волны — всегда (и на hit, и на miss), чтобы было "куда прилетело"
    var wave = document.createElement("div");
    wave.className = "fx-wave";
    var core = document.createElement("div");
    core.className = "core";
    wave.appendChild(core);
    var ring3 = document.createElement("div");
    ring3.className = "ring3";
    wave.appendChild(ring3);
    cell.appendChild(wave);

    if (result === "hit" || result === "sunk") {
      var fx = document.createElement("div");
      fx.className = "fx-explosion";
      cell.appendChild(fx);
      var panel = document.getElementById("myBoardPanel");
      panel.classList.remove("board-shake"); void panel.offsetWidth; panel.classList.add("board-shake");
      setTimeout(function() {
        if (fx.parentNode) fx.parentNode.removeChild(fx);
        if (panel) panel.classList.remove("board-shake");
      }, 520);
    }

    setTimeout(function() {
      if (wave.parentNode) wave.parentNode.removeChild(wave);
      resolve();
    }, 1250);
  });
}

// ── ЛОКАЛЬНОЕ ОБНОВЛЕНИЕ ВЫСТРЕЛА ─────────────────────────────
// res — ответ сервера с sunkCells и sunkPerimeter
function applyLocalShot(x, y, result, res) {
  if (!state.gameState) return;
  var shots = state.mySlot === 1 ? state.gameState.shotsP1 : state.gameState.shotsP2;

  // Проверяем нет ли дублей
  for (var i = 0; i < shots.length; i++) {
    if (shots[i].x === x && shots[i].y === y) return;
  }

  if (result === "sunk") playEventSound("sunkEnemy");
  else if (result === "hit") playEventSound("hitEnemy");
  else if (result === "miss") playEventSound("miss");

  var shotObj = { x: x, y: y, result: result };
  if (result === "sunk" && res) {
    shotObj.sunkCells     = res.sunkCells     || [];
    shotObj.sunkPerimeter = res.sunkPerimeter || [];
  } else if (result === "hit" && res && res.hitCorners) {
    shotObj.hitCorners = res.hitCorners;
  }
  shots.push(shotObj);

  if (result === "sunk" && res && res.sunkCells) {
    // Отрисовываем весь потопленный корабль
    res.sunkCells.forEach(function(c) {
      var cell = getEnemyCellElement(c.x, c.y);
      if (cell) { cell.className = "cell enemy-cell sunk"; }
    });
    // Отрисовываем периметр как промахи и добавляем в shots
    if (res.sunkPerimeter) {
      res.sunkPerimeter.forEach(function(c) {
        var key_exists = false;
        for (var j = 0; j < shots.length; j++) {
          if (shots[j].x === c.x && shots[j].y === c.y) { key_exists = true; break; }
        }
        if (!key_exists) shots.push({ x: c.x, y: c.y, result: "miss", auto: true });
        var cell = getEnemyCellElement(c.x, c.y);
        if (cell && !cell.classList.contains("sunk") && !cell.classList.contains("hit")) {
          cell.className = "cell enemy-cell miss";
        }
      });
    }
  } else {
    // Обычное попадание или промах
    var cell = getEnemyCellElement(x, y);
    if (cell) {
      cell.className = "cell enemy-cell";
      if (result === "hit")       cell.classList.add("hit");
      else if (result === "miss") cell.classList.add("miss");
    }
    // Угловые клетки попадания → промахи
    if (result === "hit" && res && res.hitCorners) {
      res.hitCorners.forEach(function(c) {
        var key_exists = false;
        for (var j = 0; j < shots.length; j++) {
          if (shots[j].x === c.x && shots[j].y === c.y) { key_exists = true; break; }
        }
        if (!key_exists) shots.push({ x: c.x, y: c.y, result: "miss", auto: true });
        var cornerCell = getEnemyCellElement(c.x, c.y);
        if (cornerCell && !cornerCell.classList.contains("sunk") && !cornerCell.classList.contains("hit")) {
          cornerCell.className = "cell enemy-cell miss";
        }
      });
    }
  }

  var resText = result === "hit" ? "Попадание!" : result === "sunk" ? "Потоплен!" : "Промах";
  addLog("Вы → " + COL_LABELS[x] + ROW_LABELS[y] + ": " + resText, result);
}

// ── ПЕРЕКЛЮЧЕНИЕ ХОДА ПОСЛЕ ВЫСТРЕЛА ─────────────────────────
async function handleTurnTransition(result, res) {
  if (result === "hit" || result === "sunk") {
    await showPhaseAnnouncement(result === "sunk" ? "💥 ПОТОПЛЕН! ЕЩЁ РАЗ!" : "🎯 ПОПАДАНИЕ! ЕЩЁ РАЗ!", "my");
    setEnemyGridShootable(true);
  } else {
    await showPhaseAnnouncement("💦 ПРОМАХ! ХОД ПРОТИВНИКА", "enemy");
    switchView("mine", true);
    updateTurnBadge(false, getEnemyName());
  }
}

function getEnemyName() {
  var gs = state.gameState;
  if (!gs || !gs.players) return "ПРОТИВНИК";
  var enemy = gs.players.filter(function(p){ return p.playerId !== state.playerId; })[0];
  return enemy ? enemy.nickname.toUpperCase() : "ПРОТИВНИК";
}

// ── ПОСЛЕДНИЙ ВЫСТРЕЛ: вычисление из массива shots ─────────────
function computeLastNonPerimeterShot(shots) {
  if (!shots || !shots.length) return null;
  var perim = {};
  for (var i = 0; i < shots.length; i++) {
    var s = shots[i];
    if (s && s.result === "sunk" && s.sunkPerimeter && s.sunkPerimeter.length) {
      for (var j = 0; j < s.sunkPerimeter.length; j++) {
        var c = s.sunkPerimeter[j];
        perim[c.y + "_" + c.x] = true;
      }
    }
  }
  for (var k = shots.length - 1; k >= 0; k--) {
    var t = shots[k];
    if (!t) continue;
    if (t.auto) continue;
    var key = t.y + "_" + t.x;
    if (t.result !== "miss" || !perim[key]) return { x: t.x, y: t.y };
  }
  // fallback
  var last = shots[shots.length - 1];
  return last ? { x: last.x, y: last.y } : null;
}

// ── POLLING СОСТОЯНИЯ ─────────────────────────────────────────
function startPolling() { _roomMissingHandled = false; fetchState(); state.pollTimer = setInterval(fetchState, POLL_INTERVAL); }
function stopPolling()  { if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; } }

var _fetchStatePending = false;
var _roomMissingHandled = false;

function isRoomMissingErrorMessage(msg) {
  return /комната\s+не\s+найдена/i.test(String(msg || ""));
}

function handleRoomMissingFromServer(errorText) {
  if (_roomMissingHandled) return;
  _roomMissingHandled = true;
  showAppToast("Комната удалена или устарела. Возврат в лобби.", "warning", 4200);
  addLog("Сессия завершена: " + String(errorText || "комната удалена"), "miss");
  leaveGame();
}

async function fetchState() {
  if (_fetchStatePending) return;          // защита от параллельных вызовов
  _fetchStatePending = true;
  var dot = document.getElementById("pollingDot");
  if (dot) dot.classList.add("active");
  try {
    var gs = await apiGet({ playerId: state.playerId, roomId: state.roomId });
    if (dot) dot.classList.remove("active");
    if (!gs.ok) {
      var errText = String(gs && gs.error ? gs.error : "");
      if (isRoomMissingErrorMessage(errText)) {
        handleRoomMissingFromServer(errText);
      }
      return;
    }
    _roomMissingHandled = false;
    processGameState(gs);
  } catch(e) { if (dot) dot.classList.remove("active"); }
  finally { _fetchStatePending = false; }
}

// ── ОБРАБОТКА СОСТОЯНИЯ ───────────────────────────────────────
function processGameState(gs) {
  var prevState = state.gameState;
  state.gameState = gs;

  if (gs.myBoard) state.myBoard = gs.myBoard;

  // обновляем "последний выстрел" (важно при F5/переподключении)
  try {
    var myShotsNow    = state.mySlot === 1 ? gs.shotsP1 : gs.shotsP2;
    var enemyShotsNow = state.mySlot === 1 ? gs.shotsP2 : gs.shotsP1;
    state.lastShot.my    = computeLastNonPerimeterShot(myShotsNow);
    state.lastShot.enemy = computeLastNonPerimeterShot(enemyShotsNow);
  } catch(e) {}

  updateStatusBar(gs);

  var isGameStartTransition = !!(prevState && prevState.phase === "waiting" && gs.phase === "playing");
  if (isGameStartTransition) {
    playEventSound("gameStart");
  }

  if (gs.phase === "waiting") {
    document.getElementById("waitingBlock").style.display = "block";
    document.getElementById("boardsBlock").style.display  = "none";
    document.getElementById("viewSwitcher").style.display = "none";
    return;
  }

  document.getElementById("waitingBlock").style.display = "none";
  document.getElementById("boardsBlock").style.display  = "block";
  document.getElementById("viewSwitcher").style.display = "flex";

  renderMyBoard(gs);
  renderEnemyBoard(gs);
  ensureHitCornerMisses();
  renderFleetIndicators(gs);

  var isMyTurn = (gs.phase === "playing" && gs.turn === state.playerId);
  var enemy = gs.players ? gs.players.filter(function(p){ return p.playerId !== state.playerId; })[0] : null;
  var enemyName = enemy ? enemy.nickname : "ПРОТИВНИК";

  var turnChanged = prevState && prevState.turn !== gs.turn && !state.inputLocked;

  if (turnChanged && !state.inputLocked) {
    if (isGameStartTransition) {
      // Даём gameStart доиграть (~5 сек), потом звук хода
      var _isMyTurn = isMyTurn, _enemyName = enemyName;
      setTimeout(function() {
        if (_isMyTurn || !solo.active) playEventSound(_isMyTurn ? "turnMine" : "turnEnemy");
      }, 5000);
    } else {
      if (isMyTurn || !solo.active) playEventSound(isMyTurn ? "turnMine" : "turnEnemy");
    }
    if (isMyTurn) {
      (async function() {
        await showPhaseAnnouncement("⚡ ВАШ ХОД!", "my");
        // Если только что был выстрел противника — задержим переключение, чтобы игрок увидел попадание
        var wait = state.enemyShotShowUntil ? (state.enemyShotShowUntil - Date.now()) : 0;
        if (wait > 0) await sleepMs(wait);
        switchView("enemy", true);
        updateTurnBadge(true, enemyName);
        setEnemyGridShootable(true);
      })();
    } else {
      switchView("mine", true);
      updateTurnBadge(false, enemyName);
      setEnemyGridShootable(false);
    }
  } else if (!state.inputLocked) {
    if (isMyTurn) {
      if (state.currentView !== "enemy") switchView("enemy", false);
      updateTurnBadge(true, enemyName);
      setEnemyGridShootable(true);
    } else {
      if (state.currentView !== "mine") switchView("mine", false);
      updateTurnBadge(false, enemyName);
      setEnemyGridShootable(false);
    }
  }

  updateLog(gs, prevState);

  if (gs.phase === "finished" && gs.winner && !state.winnerShown) {
    state.winnerShown = true;
    stopPolling();
    showWinner(gs);
  }
}

// ── СТАТУС-БАР ────────────────────────────────────────────────
function updateStatusBar(gs) {
  var enemy = gs.players ? gs.players.filter(function(p){ return p.playerId !== state.playerId; })[0] : null;
  document.getElementById("statusMe").textContent    = state.nickname || "—";
  document.getElementById("statusEnemy").textContent = enemy ? enemy.nickname : "Ожидание...";

  var phaseMap = { waiting: "Ожидание", playing: "Игра", finished: "Конец" };
  var dot = document.getElementById("phaseDot");
  dot.className = "phase-dot " + (gs.phase || "waiting");
  document.getElementById("statusPhase").textContent = phaseMap[gs.phase] || gs.phase;

  var turnPlayer = gs.players ? gs.players.filter(function(p){ return p.playerId === gs.turn; })[0] : null;
  var turnEl = document.getElementById("statusTurn");
  if (!turnPlayer) {
    turnEl.textContent = "—"; turnEl.classList.remove("active");
  } else {
    turnEl.textContent = turnPlayer.nickname;
    if (gs.turn === state.playerId) {
      turnEl.textContent += "";
      turnEl.classList.add("active");
    } else {
      turnEl.classList.remove("active");
    }
  }
}

// ── РЕНДЕР СВОЕГО ПОЛЯ ────────────────────────────────────────
function renderMyBoard(gs) {
  var board = state.myBoard;
  if (!board) return;
  var enemyShots = state.mySlot === 1 ? gs.shotsP2 : gs.shotsP1;
  var shotMap = {};
  if (enemyShots) {
    enemyShots.forEach(function(s){
      if (s.result === "sunk" && s.sunkCells) {
        s.sunkCells.forEach(function(c){ shotMap[c.y+"_"+c.x] = "sunk"; });
        if (s.sunkPerimeter) s.sunkPerimeter.forEach(function(c){ if (!shotMap[c.y+"_"+c.x]) shotMap[c.y+"_"+c.x] = "miss"; });
      } else {
        shotMap[s.y+"_"+s.x] = s.result;
        if (s.result === "hit" && s.hitCorners) {
          s.hitCorners.forEach(function(c){ if (!shotMap[c.y+"_"+c.x]) shotMap[c.y+"_"+c.x] = "miss"; });
        }
      }
    });
  }

  var cells = document.querySelectorAll("#myGrid .cell");
  cells.forEach(function(cell) {
    var x = parseInt(cell.dataset.x), y = parseInt(cell.dataset.y);
    var shot = shotMap[y+"_"+x];
    var cellVal = board[y][x];
    cell.className = "cell";
    if      (shot === "sunk")  cell.classList.add("my-sunk");
    else if (shot === "hit")   cell.classList.add("my-hit");
    else if (shot === "miss")  cell.classList.add("miss");
    else if (cellVal === 1 || cellVal === 2) cell.classList.add("ship");
    if (state.lastShot.enemy && state.lastShot.enemy.x === x && state.lastShot.enemy.y === y) {
      cell.classList.add("last-shot-enemy");
    }
  });
  updateWinProbability();

  // ←←← ФИКС: угловые miss вокруг последнего попадания противника
  ensureHitCornerMisses();
}

// ── РЕНДЕР ПОЛЯ ПРОТИВНИКА ────────────────────────────────────
function renderEnemyBoard(gs) {
  var myShots = state.mySlot === 1 ? gs.shotsP1 : gs.shotsP2;
  var shotMap = {};

  if (myShots) {
    myShots.forEach(function(s) {
      if (s.result === "sunk" && s.sunkCells) {
        s.sunkCells.forEach(function(c){ shotMap[c.y+"_"+c.x] = "sunk"; });
        if (s.sunkPerimeter) s.sunkPerimeter.forEach(function(c){ if (!shotMap[c.y+"_"+c.x]) shotMap[c.y+"_"+c.x] = "miss"; });
      } else {
        shotMap[s.y+"_"+s.x] = s.result;
        if (s.result === "hit" && s.hitCorners) {
          s.hitCorners.forEach(function(c){ if (!shotMap[c.y+"_"+c.x]) shotMap[c.y+"_"+c.x] = "miss"; });
        }
      }
    });
  }

  var cells = document.querySelectorAll("#enemyGrid .cell");
  cells.forEach(function(cell) {
    var x = parseInt(cell.dataset.x), y = parseInt(cell.dataset.y);
    var shot = shotMap[y+"_"+x];
    cell.className = "cell enemy-cell";
    if      (shot === "sunk")  cell.classList.add("sunk");
    else if (shot === "hit")   cell.classList.add("hit");
    else if (shot === "miss")  cell.classList.add("miss");
    if (state.lastShot.my && state.lastShot.my.x === x && state.lastShot.my.y === y) {
      cell.classList.add("last-shot");
    }
  });
  updateWinProbability();

  // ←←← ФИКС: угловые miss вокруг последнего попадания
  ensureHitCornerMisses();
}

// ── КЛИКАБЕЛЬНОСТЬ ПОЛЯ ПРОТИВНИКА ───────────────────────────
function setEnemyGridShootable(enabled) {
  var myShots = state.gameState ? (state.mySlot === 1 ? state.gameState.shotsP1 : state.gameState.shotsP2) : [];
  var blocked = {};
  if (myShots) {
    myShots.forEach(function(s) {
      blocked[s.y+"_"+s.x] = true;
      // Также блокируем периметр потопленных
      if (s.result === "sunk" && s.sunkCells) {
        s.sunkCells.forEach(function(c){ blocked[c.y+"_"+c.x] = true; });
        if (s.sunkPerimeter) s.sunkPerimeter.forEach(function(c){ blocked[c.y+"_"+c.x] = true; });
      }
    });
  }

  var cells = document.querySelectorAll("#enemyGrid .cell");
  cells.forEach(function(cell) {
    var x = parseInt(cell.dataset.x), y = parseInt(cell.dataset.y);
    var isBlocked = blocked[y+"_"+x] ||
      cell.classList.contains("hit") ||
      cell.classList.contains("miss") ||
      cell.classList.contains("sunk");
    if (enabled && !isBlocked) {
      cell.classList.add("shootable");
    } else {
      cell.classList.remove("shootable");
    }
  });
}

// ── ЖУРНАЛ ХОДОВ ─────────────────────────────────────────────
function updateLog(gs, prevState) {
  var myShots    = state.mySlot === 1 ? gs.shotsP1 : gs.shotsP2;
  var enemyShots = state.mySlot === 1 ? gs.shotsP2 : gs.shotsP1;
  var prevEnemy  = prevState ? (state.mySlot === 1 ? prevState.shotsP2 : prevState.shotsP1) : [];

  var enemy = gs.players ? gs.players.filter(function(p){ return p.playerId !== state.playerId; })[0] : null;
  var enemyName = enemy ? enemy.nickname : "Противник";

  if (enemyShots && enemyShots.length > (prevEnemy ? prevEnemy.length : 0)) {
    for (var j = (prevEnemy ? prevEnemy.length : 0); j < enemyShots.length; j++) {
      var es = enemyShots[j];
      state.lastShot.enemy = { x: es.x, y: es.y };

      // Показываем входящий выстрел на "моём поле" и даём время заметить
      // (на свой ход переключимся с задержкой)
      state.enemyShotShowUntil = Date.now() + 1200;
      if (state.currentView !== "mine") switchView("mine", true);
      (function(x, y, r) {
        var myCell = getMyCellElement(x, y);
        // эффект запускаем асинхронно, без ожидания polling
        playIncomingImpactEffect(myCell, r || "miss");
      })(es.x, es.y, es.result);

      // Иногда вражеские выстрелы "догоняют" polling-ом и могут наложиться на звук нашего выстрела.
      // Подавляем вражеские SFX, если прямо сейчас мы в процессе выстрела или выстрелили совсем недавно.
      var suppressEnemySfx = state.inputLocked || (Date.now() - (audioState.lastPlayerShotAt || 0) < 1200);
      if (!suppressEnemySfx) {
        if (es.result === "sunk") playEventSound("sunkMe");
        else if (es.result === "hit") playEventSound("hitMe");
        else if (es.result === "miss") playEventSound("enemyMiss");
      }
      var eText = es.result === "hit" ? "Попадание!" : es.result === "sunk" ? "Потопил!" : "Промах";
      addLog(enemyName + " → " + COL_LABELS[es.x] + ROW_LABELS[es.y] + ": " + eText, es.result);
    }
  }
}

function addLog(text, type) {
  var list = document.getElementById("logList");
  var li   = document.createElement("li");
  var now  = new Date();
  var ts   = pad(now.getHours()) + ":" + pad(now.getMinutes()) + ":" + pad(now.getSeconds());
  li.className = "log-entry " + (type || "miss");
  li.innerHTML = '<span class="ts">' + ts + '</span>' + text;
  list.insertBefore(li, list.firstChild);
  while (list.children.length > 300) list.removeChild(list.lastChild);
  
  // Сохраняем лог в зависимости от режима
  if (solo && solo.active) {
    saveSoloLog();
  } else {
    saveLog();
  }
}

function saveLog() {
  try {
    var list = document.getElementById("logList");
    var items = [];
    list.querySelectorAll("li").forEach(function(li) {
      items.push({ html: li.innerHTML, cls: li.className });
    });
    localStorage.setItem("mb_log_" + (state.roomId || ""), JSON.stringify(items));
  } catch(e) {}
}

function restoreLog() {
  try {
    var raw = localStorage.getItem("mb_log_" + (state.roomId || ""));
    if (!raw) return;
    var items = JSON.parse(raw);
    var list = document.getElementById("logList");
    list.innerHTML = "";
    items.forEach(function(item) {
      var li = document.createElement("li");
      li.className = item.cls;
      li.innerHTML = item.html;
      list.appendChild(li);
    });
  } catch(e) {}
}

// ── СОХРАНЕНИЕ ЛОГА ДЛЯ СОЛО-РЕЖИМА ─────────────────────────────
function saveSoloLog() {
  try {
    var list = document.getElementById("logList");
    var items = [];
    list.querySelectorAll("li").forEach(function(li) {
      items.push({ html: li.innerHTML, cls: li.className });
    });
    localStorage.setItem("mb_solo_log", JSON.stringify(items));
  } catch(e) {}
}

function restoreSoloLog() {
  try {
    var raw = localStorage.getItem("mb_solo_log");
    if (!raw) return;
    var items = JSON.parse(raw);
    var list = document.getElementById("logList");
    list.innerHTML = "";
    items.forEach(function(item) {
      var li = document.createElement("li");
      li.className = item.cls;
      li.innerHTML = item.html;
      list.appendChild(li);
    });
  } catch(e) {}
}

function clearSoloLog() {
  try { localStorage.removeItem("mb_solo_log"); } catch(e) {}
}

function clearSavedLog() {
  try { localStorage.removeItem("mb_log_" + (state.roomId || "")); } catch(e) {}
}

function pad(n) { return n < 10 ? "0" + n : String(n); }

// ── ПОБЕДИТЕЛЬ ────────────────────────────────────────────────
function showWinner(gs) {
  var overlay      = document.getElementById("winnerOverlay");
  var winnerPlayer = gs.players ? gs.players.filter(function(p){ return p.playerId === gs.winner; })[0] : null;
  var winnerName   = winnerPlayer ? winnerPlayer.nickname : "Неизвестный";
  var isMe         = gs.winner === state.playerId;
  document.getElementById("winnerName").textContent = isMe ? "ВЫ ПОБЕДИЛИ!" : winnerName.toUpperCase();
  document.getElementById("winnerMsg").textContent  = isMe ? "Все корабли противника потоплены!" : "одержал победу в морском бою";
  overlay.classList.add("show");
  playEventSound(isMe ? "gameWin" : "gameLose");
}
function closeWinner() { document.getElementById("winnerOverlay").classList.remove("show"); }

// ── ВЫХОД ────────────────────────────────────────────────────
function leaveGame() {
  _roomMissingHandled = false;
  if (state.playerId && state.roomId) {
    apiPost({ action: "leave", playerId: state.playerId, roomId: state.roomId }).catch(function(){});
  }
  stopPolling();
  clearSession();
  state.nickname    = loadSavedNickname();
  state.gameState   = null;
  state.winnerShown = false;
  state.currentView = "mine";
  state.inputLocked = false;
  unlockInput();
  document.getElementById("winnerOverlay").classList.remove("show");
  document.getElementById("logList").innerHTML = "";
  clearSavedLog();
  // Возвращаем в лобби (ник уже запомнен)
  document.getElementById("lobbyNickname").textContent = state.nickname || "";
  document.getElementById("createMsg").innerHTML = "";
  showScreen("lobbyScreen");
  startLobbyPolling();
}

// ── СПИСОК КОМНАТ / УДАЛЕНИЕ (ADMIN) ────────────────────────
function _phaseLabelRu(phase) {
  if (phase === "waiting") return "ожидание";
  if (phase === "playing") return "игра";
  return String(phase || "—");
}

function renderAdminRoomsList(rooms) {
  var box = document.getElementById("adminRoomsList");
  var hint = document.getElementById("adminRoomsHint");
  var panel = document.getElementById("adminRoomsPanel");
  if (!box || !panel) return;

  if (hint) hint.textContent = rooms.length
    ? "Комнат: " + rooms.length
    : "Нет записей";

  if (!rooms.length) {
    box.innerHTML = '<div class="admin-rooms-empty">Нет активных комнат на сервере.</div>';
    panel.hidden = false;
    return;
  }

  var curId = (typeof state !== "undefined" && state && state.roomId) ? state.roomId : "";
  var html = '<table class="admin-rooms-table"><thead><tr>'
    + "<th>Комната</th><th>Игроки</th><th>Фаза</th><th></th>"
    + "</tr></thead><tbody>";

  rooms.forEach(function (r) {
    var n = r.playerCount != null ? r.playerCount : 0;
    var nickLine = [];
    if (r.player1Nick) nickLine.push(escapeHtml(r.player1Nick));
    if (r.player2Nick) nickLine.push(escapeHtml(r.player2Nick));
    var names = nickLine.length ? nickLine.join(" · ") : '<span class="admin-rooms-dim">—</span>';
    var cur = curId && r.roomId === curId ? ' <span class="admin-rooms-badge">вы здесь</span>' : "";
    html += "<tr>"
      + '<td class="admin-rooms-id">' + escapeHtml(r.roomId) + cur + "</td>"
      + '<td><span class="admin-rooms-count">' + n + "</span> · " + names + "</td>"
      + "<td>" + escapeHtml(_phaseLabelRu(r.phase)) + "</td>"
      + '<td><button type="button" class="btn btn-danger btn-sm admin-rooms-del" data-room-id="'
      + String(r.roomId).replace(/"/g, "&quot;") + '">Удалить</button></td>'
      + "</tr>";
  });

  html += "</tbody></table>";
  box.innerHTML = html;

  box.querySelectorAll(".admin-rooms-del").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var rid = btn.getAttribute("data-room-id");
      if (rid) adminDeleteRoom(rid);
    });
  });

  panel.hidden = false;
}

async function loadAdminRoomsList() {
  var pwdEl = document.getElementById("adminPassword");
  var pwd = pwdEl ? pwdEl.value.trim() : "";
  if (!pwd) {
    showAppToast("Введите пароль администратора", "warning", 4000);
    if (pwdEl) pwdEl.focus();
    return;
  }
  try {
    var res = await apiPost({ action: "listRoomsAdmin", password: pwd });
    if (res.ok && res.rooms) {
      renderAdminRoomsList(res.rooms);
    } else {
      showAppToast(res.error || "Не удалось получить список комнат", "error");
    }
  } catch (e) {
    showAppToast("Нет связи с сервером. Проверьте сеть и повторите.", "error");
  }
}

async function adminDeleteRoom(roomId) {
  if (!roomId) return;
  var pwdEl = document.getElementById("adminPassword");
  var pwd = pwdEl ? pwdEl.value.trim() : "";
  if (!pwd) {
    showAppToast("Введите пароль администратора", "warning", 4000);
    if (pwdEl) pwdEl.focus();
    return;
  }
  var confirmed = await showAdminConfirm({
    title: "Удалить комнату?",
    message: "«" + roomId + "»",
    detail: "Комната будет удалена с сервера без восстановления. Все игроки в ней потеряют сессию.",
    confirmLabel: "Удалить",
    cancelLabel: "Отмена"
  });
  if (!confirmed) return;
  try {
    var res = await apiPost({ action: "restart", password: pwd, roomId: roomId });
    if (res.ok) {
      var wasHere = (typeof state !== "undefined" && state && state.roomId === roomId);
      if (wasHere) {
        state.winnerShown = false;
        document.getElementById("winnerOverlay").classList.remove("show");
        leaveGame();
      }
      showAppToast("Комната " + roomId + " удалена", "ok", 3200);
      await loadAdminRoomsList();
    } else {
      showAppToast(res.error || "Операция не выполнена", "error");
    }
  } catch (e) {
    showAppToast("Нет связи с сервером. Проверьте сеть и повторите.", "error");
  }
}

// ── ИНДИКАТОРЫ ФЛОТА ───────────────────────────────────────────
var FLEET_LAYOUT = [4,3,3,2,2,2,1,1,1,1];

function getShotsMapFromShots(shots) {
  var map = {};
  if (!shots) return map;
  shots.forEach(function(s) {
    if (!s) return;
    if (s.result === "sunk" && s.sunkCells) {
      s.sunkCells.forEach(function(c){ map[c.y + "_" + c.x] = "sunk"; });
      if (s.sunkPerimeter) s.sunkPerimeter.forEach(function(c){ if (!map[c.y + "_" + c.x]) map[c.y + "_" + c.x] = "miss"; });
    } else {
      map[s.y + "_" + s.x] = s.result;
      if (s.result === "hit" && s.hitCorners) {
        s.hitCorners.forEach(function(c){ if (!map[c.y + "_" + c.x]) map[c.y + "_" + c.x] = "miss"; });
      }
    }
  });
  return map;
}

function extractShipsFromBoard(board) {
  if (!board) return [];
  var h = board.length, w = board[0] ? board[0].length : 0;
  var seen = {};
  var ships = [];
  function isShipCell(x, y) {
    var v = board[y][x];
    return v === 1 || v === 2;
  }
  function key(x, y) { return y + "_" + x; }
  function neighbors(x, y) {
    var res = [];
    if (x > 0) res.push([x - 1, y]);
    if (x < w - 1) res.push([x + 1, y]);
    if (y > 0) res.push([x, y - 1]);
    if (y < h - 1) res.push([x, y + 1]);
    return res;
  }
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      if (!isShipCell(x, y)) continue;
      var k = key(x, y);
      if (seen[k]) continue;
      var q = [[x, y]];
      seen[k] = true;
      var cells = [];
      while (q.length) {
        var cur = q.pop();
        cells.push({ x: cur[0], y: cur[1] });
        var nb = neighbors(cur[0], cur[1]);
        for (var i = 0; i < nb.length; i++) {
          var nx = nb[i][0], ny = nb[i][1];
          if (!isShipCell(nx, ny)) continue;
          var nk = key(nx, ny);
          if (seen[nk]) continue;
          seen[nk] = true;
          q.push([nx, ny]);
        }
      }
      ships.push(cells);
    }
  }
  // стабильный порядок: длинные слева, затем по координатам
  ships.sort(function(a, b) {
    if (b.length !== a.length) return b.length - a.length;
    var ax = a[0].x, ay = a[0].y, bx = b[0].x, by = b[0].y;
    return ay !== by ? ay - by : ax - bx;
  });
  return ships;
}

function renderFleetBar(elId, shipsSegments, isEnemy) {
  var el = document.getElementById(elId);
  if (!el) return;
  var html = "";
  for (var i = 0; i < shipsSegments.length; i++) {
    var segs = shipsSegments[i];
    html += '<div class="fleet-ship' + (isEnemy ? " enemy" : "") + '">';
    for (var j = 0; j < segs.length; j++) {
      html += '<span class="fleet-seg ' + segs[j] + '"></span>';
    }
    html += "</div>";
  }
  el.innerHTML = html;
}

function renderFleetIndicators(gs) {
  if (!gs || gs.phase !== "playing" && gs.phase !== "finished") return;

  // МОЙ флот: точные корабли из myBoard + вражеские выстрелы
  var board = state.myBoard;
  var enemyShots = state.mySlot === 1 ? gs.shotsP2 : gs.shotsP1;
  var enemyShotMap = getShotsMapFromShots(enemyShots);
  var myShips = extractShipsFromBoard(board);
  var mySegments = myShips.map(function(cells) {
    // определяем sunk/частично hit/ok по клеткам
    var allSunk = true;
    var segs = [];
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      var res = enemyShotMap[c.y + "_" + c.x];
      if (res === "sunk") segs.push("sunk");
      else if (res === "hit") { segs.push("hit"); allSunk = false; }
      else { segs.push("ok"); allSunk = false; }
    }
    if (allSunk) return segs.map(function(){ return "sunk"; });
    return segs;
  });
  renderFleetBar("myFleetIndicator", mySegments, false);

  // Флот противника: точные потопленные, остальные — эвристика по количеству попаданий
  var myShots = state.mySlot === 1 ? gs.shotsP1 : gs.shotsP2;
  var sunkLens = [];
  // ВАЖНО: по противнику мы не показываем "ранения" (hit), только точно известные sunk.
  if (myShots) {
    myShots.forEach(function(s) {
      if (!s) return;
      if (s.result === "sunk" && s.sunkCells && s.sunkCells.length) {
        sunkLens.push(s.sunkCells.length);
      }
    });
  }
  sunkLens.sort(function(a, b){ return b - a; });

  // распределяем потопленные по стандартному набору (4,3,3,2,2,2,1,1,1,1)
  var layout = FLEET_LAYOUT.slice();
  var sunkUsed = new Array(layout.length).fill(false);
  for (var si = 0; si < sunkLens.length; si++) {
    var len = sunkLens[si];
    for (var li = 0; li < layout.length; li++) {
      if (!sunkUsed[li] && layout[li] === len) { sunkUsed[li] = true; break; }
    }
  }

  var enemySegments = [];
  for (var idx = 0; idx < layout.length; idx++) {
    var L = layout[idx];
    if (sunkUsed[idx]) {
      enemySegments.push(new Array(L).fill("sunk"));
    } else {
      enemySegments.push(new Array(L).fill("ok"));
    }
  }
  renderFleetBar("enemyFleetIndicator", enemySegments, true);
}

// ═══════════════════════════════════════════════════════════════
// РЕЖИМ ОДИНОЧНОЙ ИГРЫ (vs Компьютер)
// ═══════════════════════════════════════════════════════════════

var solo = {
  active:   false,
  myBoard:  null,  // 10x10: 0=вода,1=корабль
  aiBoard:  null,  // 10x10: 0=вода,1=корабль (скрыто от игрока)
  shotsP1:  [],    // выстрелы игрока
  shotsP2:  [],    // выстрелы ИИ
  turn:     "player", // "player"|"ai"
  phase:    "playing",
  winner:   null,
  // ИИ-стратегия
  ai: {
    hitQueue: [],   // клетки рядом с попаданиями для добивания
    tried:    {},   // ключи y_x уже проверенных клеток
  }
};

// ── РАССТАНОВКА КОРАБЛЕЙ ──────────────────────────────────────
function soloPlaceShips() {
  var FLEET = [4,3,3,2,2,2,1,1,1,1];
  var board = [];
  for (var r = 0; r < 10; r++) { board.push([]); for (var c = 0; c < 10; c++) board[r].push(0); }

  function canPlace(b, x, y, len, horiz) {
    for (var i = 0; i < len; i++) {
      var cx = x + (horiz ? i : 0), cy = y + (horiz ? 0 : i);
      if (cx < 0 || cx > 9 || cy < 0 || cy > 9) return false;
      // проверяем клетку и периметр
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        var nx = cx + dx, ny = cy + dy;
        if (nx >= 0 && nx <= 9 && ny >= 0 && ny <= 9 && b[ny][nx] === 1) return false;
      }
    }
    return true;
  }

  function place(b, x, y, len, horiz) {
    for (var i = 0; i < len; i++) {
      var cx = x + (horiz ? i : 0), cy = y + (horiz ? 0 : i);
      b[cy][cx] = 1;
    }
  }

  for (var s = 0; s < FLEET.length; s++) {
    var len = FLEET[s];
    var placed = false;
    for (var attempt = 0; attempt < 1000 && !placed; attempt++) {
      var horiz = Math.random() < 0.5;
      var x = Math.floor(Math.random() * 10);
      var y = Math.floor(Math.random() * 10);
      if (canPlace(board, x, y, len, horiz)) {
        place(board, x, y, len, horiz);
        placed = true;
      }
    }
    if (!placed) return soloPlaceShips();
  }
  return board;
}

// ── ФИКС: угловые miss-клетки вокруг ВСЕХ попаданий (не пропадают) ──
function ensureHitCornerMisses() {
  // Поле противника — защищаем ВСЕ hit и sunk
  const enemyGrid = document.getElementById('enemyGrid');
  if (enemyGrid) {
    const hits = enemyGrid.querySelectorAll('.cell.hit, .cell.sunk');
    hits.forEach(cell => {
      const x = parseInt(cell.dataset.x);
      const y = parseInt(cell.dataset.y);
      if (isNaN(x) || isNaN(y)) return;
      applyDiagonalMisses('enemyGrid', x, y, true);
    });
  }

  // Своё поле — защищаем ВСЕ my-hit и my-sunk
  const myGrid = document.getElementById('myGrid');
  if (myGrid) {
    const hits = myGrid.querySelectorAll('.cell.my-hit, .cell.my-sunk');
    hits.forEach(cell => {
      const x = parseInt(cell.dataset.x);
      const y = parseInt(cell.dataset.y);
      if (isNaN(x) || isNaN(y)) return;
      applyDiagonalMisses('myGrid', x, y, false);
    });
  }
}

function applyDiagonalMisses(gridId, x, y, isEnemy) {
  const corners = [[-1,-1],[1,-1],[-1,1],[1,1]];
  corners.forEach(([dx, dy]) => {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || nx > 9 || ny < 0 || ny > 9) return;

    const cell = document.querySelector(`#${gridId} .cell[data-x="${nx}"][data-y="${ny}"]`);
    if (!cell) return;

    // Не трогаем уже попадания/потопленные
    if (cell.classList.contains('hit') || 
        cell.classList.contains('sunk') || 
        cell.classList.contains('my-hit') || 
        cell.classList.contains('my-sunk')) return;

    // Принудительно ставим miss
    if (isEnemy) {
      cell.className = 'cell enemy-cell miss';
    } else {
      cell.className = 'cell miss';
    }
  });
}

// ── ИНИЦИАЛИЗАЦИЯ СОЛО-ИГРЫ ───────────────────────────────────
async function startSoloGame(preparedBoard) {
  if (!state.nickname) return;
  var board = preparedBoard;
  if (!board) {
    board = await openPlacementSetup({ context: "solo", defaultMode: "random" });
    if (!board) return;
  }
  stopLobbyPolling();

  // Инициализируем состояние
  solo.active  = true;
  state.inputLocked = false;   // ← добавить
  unlockInput();               // ← добавить
  solo.myBoard = board;
  solo.aiBoard = soloPlaceShips();
  solo.shotsP1 = [];
  solo.shotsP2 = [];
  solo.turn    = "player";
  solo.phase   = "playing";
  solo.winner  = null;
  solo.ai      = { hitQueue: [], tried: {} };

  // Инициализируем state для переиспользования UI
  state.playerId  = "player";
  state.mySlot    = 1;
  state.roomId    = "solo";
  state.myBoard   = solo.myBoard;
  state.winnerShown = false;
  // важно: не ставим сразу "enemy", иначе switchView() может выйти раньше и не переключить панели
  state.currentView = "mine";
  state.lastShot  = { my: null, enemy: null };
  state.inputLocked = false;
  state.enemyShotShowUntil = 0;

  showScreen("gameScreen");
  buildGridLabels();
  buildGrids();
  document.getElementById("waitingBlock").style.display = "none";
  document.getElementById("boardsBlock").style.display  = "block";
  document.getElementById("viewSwitcher").style.display = "flex";
  document.getElementById("logList").innerHTML = "";
  clearSoloLog();                    // новый старт — чистим лог
  // Рендерим начальное состояние
  var gs = soloMakeGS();
  state.gameState = gs;
  updateStatusBar(gs);
  renderMyBoard(gs);
  renderEnemyBoard(gs);
  renderFleetIndicators(gs);
  updateTurnBadge(true, "КОМПЬЮТЕР");
  setEnemyGridShootable(true);
  switchView("enemy", true);

  playEventSound("gameStart");
  var _nick = state.nickname;
  setTimeout(function() { playEventSound("turnMine"); }, 5000);
}

// ── СИНТЕТИЧЕСКИЙ GAME STATE для UI ───────────────────────────
function soloMakeGS() {
  return {
    ok: true,
    phase:   solo.phase,
    turn:    solo.turn === "player" ? "player" : "ai",
    winner:  solo.winner,
    players: [
      { playerId: "player", nickname: state.nickname || "ВЫ" },
      { playerId: "ai",     nickname: "Компьютер" }
    ],
    myBoard:  solo.myBoard,
    shotsP1:  solo.shotsP1,
    shotsP2:  solo.shotsP2,
  };
}

// ── СОХРАНЕНИЕ / ВОССТАНОВЛЕНИЕ СОЛО-СЕССИИ ──────────────────
function saveSoloSession() {
  try {
    localStorage.setItem("mb_solo_session", JSON.stringify({
      myBoard:  solo.myBoard,
      aiBoard:  solo.aiBoard,
      shotsP1:  solo.shotsP1,
      shotsP2:  solo.shotsP2,
      turn:     solo.turn,
      phase:    solo.phase,
      winner:   solo.winner,
      ai:       solo.ai,
      nickname: state.nickname
    }));
  } catch(e) {}
}

function clearSoloSession() {
  try { localStorage.removeItem("mb_solo_session"); } catch(e) {}
}

async function restoreSoloSession() {
  var raw;
  try { raw = localStorage.getItem("mb_solo_session"); } catch(e) {}
  if (!raw) return false;

  var s;
  try { s = JSON.parse(raw); } catch(e) { return false; }
  if (!s || !s.myBoard || !s.aiBoard) return false;

  // ── ЖЁСТКИЙ СБРОС ─────────────────────────────────────
  solo.active  = true;
  state.inputLocked = false;
  unlockInput();

  solo.myBoard = s.myBoard;
  solo.aiBoard = s.aiBoard;
  solo.shotsP1 = s.shotsP1 || [];
  solo.shotsP2 = s.shotsP2 || [];
  solo.phase   = s.phase   || "playing";
  solo.winner  = s.winner  || null;
  solo.ai      = s.ai      || { hitQueue: [], tried: {} };

  state.nickname  = s.nickname || loadSavedNickname() || "Игрок";
  state.playerId  = "player";
  state.mySlot    = 1;
  state.roomId    = "solo";
  state.myBoard   = solo.myBoard;
  state.winnerShown = false;
  state.currentView = "mine";
  state.lastShot  = { my: null, enemy: null };
  state.enemyShotShowUntil = 0;

  showScreen("gameScreen");

  buildGridLabels();
  buildGrids();
  setupEnemyGridClickHandler();

  document.getElementById("waitingBlock").style.display = "none";
  document.getElementById("boardsBlock").style.display  = "block";
  document.getElementById("viewSwitcher").style.display = "flex";

  var gs = soloMakeGS();
  state.gameState = gs;

  updateStatusBar(gs);
  renderMyBoard(gs);
  renderEnemyBoard(gs);
  renderFleetIndicators(gs);

  restoreSoloLog();

  // ── НОВАЯ ЛОГИКА: ОПРЕДЕЛЯЕМ ХОД ПО ИСТОРИИ ВЫСТРЕЛОВ ─────
  solo.turn = determineSoloCurrentTurn();
  addLog(`🔄 Восстановление после F5: ход ${solo.turn === "player" ? "ВАШ" : "КОМПЬЮТЕРА"}`, "miss");

  // Применяем состояние
  if (solo.phase === "finished") {
    showWinner(gs);
  } else if (solo.turn === "player") {
    setEnemyGridShootable(true);
    switchView("enemy", true);
    updateTurnBadge(true, "КОМПЬЮТЕР");
  } else {
    setEnemyGridShootable(false);
    switchView("mine", true);
    updateTurnBadge(false, "КОМПЬЮТЕР");
    // Запускаем ход ИИ, если сейчас его очередь
    setTimeout(soloAITurn, 800);
  }

  console.log("✅ Solo-сессия восстановлена. Текущий ход:", solo.turn);
  saveSoloSession(); // сохраняем исправленное состояние
  return true;
}

// Определяет, чей сейчас ход, глядя на историю выстрелов + журнал (самая надёжная версия)
function determineSoloCurrentTurn() {
  if (solo.shotsP1.length === 0 && solo.shotsP2.length === 0) {
    return "player";
  }

  var lastP1 = solo.shotsP1.length > 0 ? solo.shotsP1[solo.shotsP1.length - 1] : null;
  var lastP2 = solo.shotsP2.length > 0 ? solo.shotsP2[solo.shotsP2.length - 1] : null;

  // Кто сделал больше выстрелов — тот стрелял последним
  var lastShot = null;
  var lastPlayer = null;

  if (lastP1 && lastP2) {
    if (solo.shotsP1.length > solo.shotsP2.length) {
      lastShot = lastP1;
      lastPlayer = "player";
    } else {
      lastShot = lastP2;
      lastPlayer = "ai";
    }
  } else if (lastP1) {
    lastShot = lastP1;
    lastPlayer = "player";
  } else {
    lastShot = lastP2;
    lastPlayer = "ai";
  }

  console.log(`🔍 determineSoloCurrentTurn → shotsP1=${solo.shotsP1.length}, shotsP2=${solo.shotsP2.length}, последний: ${lastPlayer} (${lastShot.result})`);

  // Правило морского боя:
  // Попадание / потопление → тот же игрок стреляет снова
  if (lastShot.result === "hit" || lastShot.result === "sunk") {
    return lastPlayer;
  }

  // Промах → ход переходит другому
  return (lastPlayer === "player") ? "ai" : "player";
}

// ── ПЕРЕХВАТ ВЫСТРЕЛА В СОЛО-РЕЖИМЕ ──────────────────────────
// Переопределяем shoot() для соло — оборачиваем оригинальный
var _originalShoot = null; // будет присвоен после определения shoot()

async function soloShoot(x, y) {
  if (state.inputLocked) return;
  if (solo.phase !== "playing" || solo.turn !== "player") return;

  var targetCell = getEnemyCellElement(x, y);
  if (!targetCell || !targetCell.classList.contains("shootable")) return;

  // Защита от двойных кликов
  if (Date.now() - (audioState.lastPlayerShotAt || 0) < 800) return;

  audioState.lastPlayerShotAt = Date.now();
  playEventSound("shoot");

  lockInput("ПРИЦЕЛИВАНИЕ...");

  try {
    setEnemyGridShootable(false);
    state.lastShot.my = { x: x, y: y };

    document.getElementById("shootingNoticeText").textContent = "ВЫСТРЕЛ!";
    await animateProjectile(targetCell);

    document.getElementById("shootingNoticeText").textContent = "РЕЗУЛЬТАТ...";
    await sleepMs(80);

    var result = soloCheckHit(solo.aiBoard, solo.shotsP1, x, y);
    await playImpactEffect(targetCell, result.type);

    // Добавляем выстрел
    var shotObj = { x: x, y: y, result: result.type };
    if (result.type === "sunk") {
      shotObj.sunkCells     = result.sunkCells;
      shotObj.sunkPerimeter = result.sunkPerimeter;
      result.sunkCells.forEach(function(c) { 
        if (solo.aiBoard[c.y] && solo.aiBoard[c.y][c.x] !== undefined) 
          solo.aiBoard[c.y][c.x] = 2; 
      });
    } else if (result.type === "hit" && result.hitCorners && result.hitCorners.length) {
      shotObj.hitCorners = result.hitCorners;
    }
    solo.shotsP1.push(shotObj);
    // Добавляем угловые авто-промахи при попадании
    if (result.type === "hit" && result.hitCorners) {
      result.hitCorners.forEach(function(c) {
        var exists = solo.shotsP1.some(function(s){ return s.x === c.x && s.y === c.y; });
        if (!exists) solo.shotsP1.push({ x: c.x, y: c.y, result: "miss", auto: true });
      });
    }
    saveSoloSession();

    // Звуки
    if (result.type === "sunk")      playEventSound("sunkEnemy");
    else if (result.type === "hit")  playEventSound("hitEnemy");
    else                             playEventSound("miss");

    var rText = result.type === "hit" ? "Попадание!" : result.type === "sunk" ? "Потоплен!" : "Промах";
    addLog("Вы → " + COL_LABELS[x] + ROW_LABELS[y] + ": " + rText, result.type);

    var gsR = soloMakeGS();
    state.gameState = gsR;
    renderEnemyBoard(gsR);
    renderFleetIndicators(gsR);

    // Проверка победы
    if (soloCountShipCells(solo.aiBoard) === 0) {
      solo.phase  = "finished";
      solo.winner = "player";
      var gs = soloMakeGS();
      state.gameState = gs;
      showWinner(gs);
      return;
    }

    if (result.type === "hit" || result.type === "sunk") {
      await showPhaseAnnouncement(result.type === "sunk" ? "💥 ПОТОПЛЕН! ЕЩЁ РАЗ!" : "🎯 ПОПАДАНИЕ! ЕЩЁ РАЗ!", "my");
      setEnemyGridShootable(true);
      updateTurnBadge(true, "КОМПЬЮТЕР");
    } else {
      await showPhaseAnnouncement("💦 ПРОМАХ! ХОД КОМПЬЮТЕРА", "enemy");
      playEventSound("turnEnemy");           // ← звук хода компьютера
      solo.turn = "ai";
      saveSoloSession();   // ← обязательно сохраняем сразу после смены хода
      var gs3 = soloMakeGS();
      state.gameState = gs3;
      renderEnemyBoard(gs3);
      renderFleetIndicators(gs3);
      switchView("mine", true);
      updateTurnBadge(false, "КОМПЬЮТЕР");
      setTimeout(soloAITurn, 1100);
    }
  } catch (e) {
    console.error("Ошибка в soloShoot:", e);
    addLog("Ошибка выстрела", "miss");
  } finally {
    unlockInput();
    // Восстанавливаем возможность стрельбы, если ход всё ещё наш
    if (solo.phase === "playing" && solo.turn === "player") {
      setEnemyGridShootable(true);
    }
  }
}

// ── ХОД ИИ ───────────────────────────────────────────────────
async function soloAITurn() {
  if (solo.phase !== "playing" || solo.turn !== "ai") return;

  // ИИ выбирает клетку
  var shot = soloAIPick();
  if (!shot) return;

  var x = shot.x, y = shot.y;
  solo.ai.tried[y + "_" + x] = true;

  var result = soloCheckHit(solo.myBoard, solo.shotsP2, x, y);
  var es = { x: x, y: y, result: result.type };
  if (result.type === "sunk") {
    es.sunkCells     = result.sunkCells;
    es.sunkPerimeter = result.sunkPerimeter;
    result.sunkCells.forEach(function(c) { solo.myBoard[c.y][c.x] = 2; });
    // Помечаем периметр как отработанный
    result.sunkPerimeter.forEach(function(c) { solo.ai.tried[c.y + "_" + c.x] = true; });
    // Очищаем очередь добивания — корабль уже потоплен
    solo.ai.hitQueue = solo.ai.hitQueue.filter(function(q) {
      return !result.sunkCells.some(function(sc){ return sc.x === q.x && sc.y === q.y; });
    });
  } else if (result.type === "hit") {
    if (result.hitCorners) {
      // Помечаем угловые клетки как уже "отработанные" для ИИ
      result.hitCorners.forEach(function(c) { solo.ai.tried[c.y + "_" + c.x] = true; });
    }
    // Добавляем соседей в очередь
    [[0,-1],[0,1],[-1,0],[1,0]].forEach(function(d) {
      var nx = x + d[0], ny = y + d[1];
      if (nx >= 0 && nx <= 9 && ny >= 0 && ny <= 9 && !solo.ai.tried[ny + "_" + nx]) {
        // Если уже есть хиты — добавляем только по оси
        solo.ai.hitQueue.push({ x: nx, y: ny });
      }
    });
  }

  // Показываем эффект на нашем поле
  state.lastShot.enemy = { x: x, y: y };
  state.enemyShotShowUntil = Date.now() + 1400;
  if (state.currentView !== "mine") switchView("mine", true);

  var myCell = getMyCellElement(x, y);

  // Звук выстрела ИИ не воспроизводится (только для игрока)

  await sleepMs(300);
  await playIncomingImpactEffect(myCell, result.type);

  // Обновляем shotsP2 и рендерим
  var shotObjForGs = { x: x, y: y, result: result.type };
  if (result.type === "sunk") {
    shotObjForGs.sunkCells     = result.sunkCells;
    shotObjForGs.sunkPerimeter = result.sunkPerimeter;
  } else if (result.type === "hit" && result.hitCorners && result.hitCorners.length) {
    shotObjForGs.hitCorners = result.hitCorners;
  }
  solo.shotsP2.push(shotObjForGs);
  // Добавляем угловые авто-промахи при попадании ИИ
  if (result.type === "hit" && result.hitCorners) {
    result.hitCorners.forEach(function(c) {
      var exists = solo.shotsP2.some(function(s){ return s.x === c.x && s.y === c.y; });
      if (!exists) solo.shotsP2.push({ x: c.x, y: c.y, result: "miss", auto: true });
    });
  }
  saveSoloSession();

  var resText = result.type === "hit" ? "Попадание!" : result.type === "sunk" ? "Потопил!" : "Промах";
  addLog("Компьютер → " + COL_LABELS[x] + ROW_LABELS[y] + ": " + resText, result.type);

  // Задержка перед звуком результата, чтобы не перекрывал shoot
  var SFX_DELAY = 1900;
  setTimeout(function() {
    if (result.type === "sunk")      playEventSound("sunkMe");
    else if (result.type === "hit")  playEventSound("hitMe");
    else                             playEventSound("enemyMiss");
  }, SFX_DELAY);

  var gs = soloMakeGS();
  state.gameState = gs;
  renderMyBoard(gs);
  renderFleetIndicators(gs);

  // Проверка победы ИИ
  if (soloCountShipCells(solo.myBoard) === 0) {
    solo.phase  = "finished";
    solo.winner = "ai";
    await sleepMs(SFX_DELAY + 1600);
    var gsF = soloMakeGS();
    state.gameState = gsF;
    unlockInput();
    showWinner(gsF);
    return;
  }

  if (result.type === "hit" || result.type === "sunk") {
    // ИИ ходит снова, но с задержкой (ждём окончания звука SFX)
    await sleepMs(SFX_DELAY + 1700);
    await showPhaseAnnouncement("💥 КОМПЬЮТЕР ПОПАЛ! ЕЩЁ РАЗ!", "enemy");
    unlockInput(); // Сбрасываем блокировку перед следующим ходом ИИ
    setTimeout(soloAITurn, 1600);
  } else {
    // Передаём ход игроку
    await sleepMs(SFX_DELAY + 1400);
    solo.turn = "player";
    saveSoloSession();   // ← обязательно сохраняем сразу после смены хода
    await showPhaseAnnouncement("⚡ ВАШ ХОД!", "my");
    var wait = state.enemyShotShowUntil ? (state.enemyShotShowUntil - Date.now()) : 0;
    if (wait > 0) await sleepMs(wait);
    switchView("enemy", true);
    updateTurnBadge(true, "КОМПЬЮТЕР");
    unlockInput();
    setEnemyGridShootable(true);
    playEventSound("turnMine");
  }
}

// ── ИИ: ВЫБОР КЛЕТКИ ─────────────────────────────────────────
function soloAIPick() {
  // Сначала добивание из очереди
  while (solo.ai.hitQueue.length > 0) {
    var cand = solo.ai.hitQueue.shift();
    var k = cand.y + "_" + cand.x;
    if (!solo.ai.tried[k]) return cand;
  }
  // Шахматный паттерн (четные диагонали сначала)
  var candidates = [];
  for (var y = 0; y < 10; y++) for (var x = 0; x < 10; x++) {
    if (!solo.ai.tried[y + "_" + x]) {
      if ((x + y) % 2 === 0) candidates.push({ x: x, y: y, prio: 1 });
      else candidates.push({ x: x, y: y, prio: 0 });
    }
  }
  candidates.sort(function(a, b) { return b.prio - a.prio; });
  if (!candidates.length) return null;
  // Из приоритетных берём случайный
  var topPrio = candidates[0].prio;
  var top = candidates.filter(function(c){ return c.prio === topPrio; });
  return top[Math.floor(Math.random() * top.length)];
}

// ── ПРОВЕРКА ПОПАДАНИЯ (общая для обоих) ─────────────────────
// Только возвращает результат, НЕ пушит в shots (вызывающий сам добавляет)
function soloCheckHit(board, shots, x, y) {
  if (board[y][x] === 1) {
    // Попадание — проверяем, потоплен ли корабль
    var shipCells = soloFindShip(board, x, y);
    // Все ли клетки корабля уже поражены (учитывая текущий выстрел)
    var hitSet = {};
    shots.forEach(function(s) {
      if (s.result === "hit" || s.result === "sunk") {
        hitSet[s.y + "_" + s.x] = true;
        if (s.sunkCells) s.sunkCells.forEach(function(c){ hitSet[c.y+"_"+c.x]=true; });
      }
    });
    hitSet[y + "_" + x] = true;

    var allHit = shipCells.every(function(c) { return hitSet[c.y + "_" + c.x]; });
    if (allHit) {
      var perimeter = soloShipPerimeter(board, shipCells, shots, x, y);
      return { type: "sunk", sunkCells: shipCells, sunkPerimeter: perimeter };
    } else {
      var corners = hitCellCorners(board, x, y, shots, x, y);
      return { type: "hit", hitCorners: corners };
    }
  } else {
    return { type: "miss" };
  }
}

function soloFindShip(board, sx, sy) {
  var cells = [];
  var visited = {};
  var queue = [[sx, sy]];
  visited[sy + "_" + sx] = true;
  while (queue.length) {
    var cur = queue.shift();
    var cx = cur[0], cy = cur[1];
    cells.push({ x: cx, y: cy });
    [[0,-1],[0,1],[-1,0],[1,0]].forEach(function(d) {
      var nx = cx + d[0], ny = cy + d[1];
      if (nx >= 0 && nx <= 9 && ny >= 0 && ny <= 9 && !visited[ny + "_" + nx] && (board[ny][nx] === 1 || board[ny][nx] === 2)) {
        visited[ny + "_" + nx] = true;
        queue.push([nx, ny]);
      }
    });
  }
  return cells;
}

// Возвращает угловые клетки вокруг одной поражённой клетки (не занятые кораблём и не простреленные)
function hitCellCorners(board, x, y, shots, currentX, currentY) {
  var corners = [[-1,-1],[1,-1],[-1,1],[1,1]];
  var shotSet = {};
  shots.forEach(function(s) { shotSet[s.y + "_" + s.x] = true; });
  shotSet[currentY + "_" + currentX] = true;
  var result = [];
  var seen = {};
  corners.forEach(function(d) {
    var nx = x + d[0], ny = y + d[1];
    var k = ny + "_" + nx;
    if (nx >= 0 && nx <= 9 && ny >= 0 && ny <= 9 && !seen[k]) {
      seen[k] = true;
      // Не отмечаем если там корабль или уже простреляно
      if ((board[ny][nx] !== 1 && board[ny][nx] !== 2) && !shotSet[k]) {
        result.push({ x: nx, y: ny });
      }
    }
  });
  return result;
}

function soloShipPerimeter(board, shipCells, shots, currentX, currentY) {
  var shipSet = {};
  shipCells.forEach(function(c) { shipSet[c.y + "_" + c.x] = true; });
  var shotSet = {};
  shots.forEach(function(s) { shotSet[s.y + "_" + s.x] = true; });
  shotSet[currentY + "_" + currentX] = true;

  var perim = [];
  var seen = {};
  shipCells.forEach(function(c) {
    for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
      var nx = c.x + dx, ny = c.y + dy;
      var k = ny + "_" + nx;
      if (nx >= 0 && nx <= 9 && ny >= 0 && ny <= 9 && !shipSet[k] && !seen[k]) {
        seen[k] = true;
        if (!shotSet[k]) perim.push({ x: nx, y: ny });
      }
    }
  });
  return perim;
}

function soloCountShipCells(board) {
  var count = 0;
  for (var y = 0; y < 10; y++) for (var x = 0; x < 10; x++) if (board[y][x] === 1) count++;
  return count;
}

// ── ПАТЧ: перехватываем shoot() в соло-режиме ────────────────
// Сохраняем ссылку после определения оригинальной функции — патчим ниже в init

// ── ВЫХОД ИЗ СОЛО-ИГРЫ ───────────────────────────────────────
function leaveSoloGame() {
  clearSoloLog();
  clearSoloSession();
  solo.active  = false;
  solo.phase   = "idle";
  state.winnerShown = false;
  state.inputLocked = false;
  unlockInput();
  document.getElementById("winnerOverlay").classList.remove("show");
  document.getElementById("logList").innerHTML = "";
  state.nickname = loadSavedNickname();
  document.getElementById("lobbyNickname").textContent = state.nickname || "";
  document.getElementById("createMsg").innerHTML = "";
  showScreen("lobbyScreen");
  startLobbyPolling();
}

// ── ПАТЧ leaveGame для соло ───────────────────────────────────
// Патчим shoot и leaveGame после их определения

(function patchForSolo() {
  var _origShoot = shoot;
  shoot = function(x, y) {
    if (solo.active) return soloShoot(x, y);
    return _origShoot(x, y);
  };

  var _origLeave = leaveGame;
  leaveGame = function() {
    if (solo.active) return leaveSoloGame();
    return _origLeave();
  };

  var _origShowWinner = showWinner;
  showWinner = function(gs) {
    if (solo.active) {
      var overlay      = document.getElementById("winnerOverlay");
      var isMe         = gs.winner === "player";
      document.getElementById("winnerName").textContent = isMe ? "ВЫ ПОБЕДИЛИ!" : "КОМПЬЮТЕР ПОБЕДИЛ";
      document.getElementById("winnerMsg").textContent  = isMe ? "Все корабли компьютера потоплены!" : "Все ваши корабли потоплены";
      overlay.classList.add("show");
      playEventSound(isMe ? "gameWin" : "gameLose");
      return;
    }
    return _origShowWinner(gs);
  };
})();

// ── ПРИНУДИТЕЛЬНАЯ РАЗБЛОКИРОВКА (админ-кнопка) ─────────────────────
function forceUnlockInput() {
  state.inputLocked = false;
  unlockInput();
  
  // Дополнительно восстанавливаем возможность стрелять (особенно полезно в соло)
  if (solo && solo.active && solo.phase === "playing" && solo.turn === "player") {
    setEnemyGridShootable(true);
    switchView("enemy", false);
    updateTurnBadge(true, "КОМПЬЮТЕР");
  }
  
  // Логируем в консоль и журнал
  console.log("🔓 Принудительная разблокировка ввода выполнена");
  addLog("🔓 Админ: ввод разблокирован", "miss");
  
  // Небольшая визуальная обратная связь
  const notice = document.getElementById("shootingNotice");
  if (notice) {
    notice.style.transition = "all 0.3s";
    notice.style.opacity = "1";
    setTimeout(() => { notice.style.opacity = "0"; }, 800);
  }
}

// ── ИНИЦИАЛИЗАЦИЯ ─────────────────────────────────────────────
(async function init() {
  window.addEventListener("resize", function() {
    var canvas = document.getElementById("projectileCanvas");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  });

  updateSoundButton();
  updateFullscreenButton();

  // UI: запоминаем свёрнутость/развёрнутость панелей
  (function initDetailsPersistence() {
    function restoreDetails(selector, key, fallbackOpen) {
      var els = document.querySelectorAll(selector);
      if (!els || !els.length) return;

      var raw = null;
      try { raw = localStorage.getItem(key); } catch (e) {}

      els.forEach(function (el) {
        if (raw === "1") el.open = true;
        else if (raw === "0") el.open = false;
        else el.open = !!fallbackOpen;

        var save = function () {
          try { localStorage.setItem(key, el.open ? "1" : "0"); } catch (e) {}
        };

        // Основной путь
        el.addEventListener("toggle", save);

        // Фолбэк: если toggle не прилетает (редко, но бывает) — сохраняем после клика по summary
        var summary = el.querySelector("summary");
        if (summary) {
          summary.addEventListener("click", function () { setTimeout(save, 0); });
          summary.addEventListener("keydown", function (e) {
            if (e.key === "Enter" || e.key === " ") setTimeout(save, 0);
          });
        }
      });
    }
    restoreDetails("details.log-panel", "mb_ui_log_open", false);
    restoreDetails("details.admin-panel", "mb_ui_admin_open", false);
  })();

  // Регистрируем SW, чтобы аудио читалось из Cache Storage (переживает F5)
  registerAudioServiceWorker();

  // Устанавливаем перехватчик сети (для Network Tracker)
  installNetworkInterceptor();

  // Иконка кэша на кнопке (🟥/🟨/🟩)
  updateCacheButtons();

  // Докачиваем недостающее в Cache Storage (без перезаписи)
  preloadAllAudioToCache({ overwrite: false, onlyMissing: true });

  // Админ: не onclick (SES/lockdown), и до любого return в init
  var btnAdminRoomsLoad = document.getElementById("btnAdminRoomsLoad");
  if (btnAdminRoomsLoad) btnAdminRoomsLoad.addEventListener("click", loadAdminRoomsList);

  var adminConfirmOv = document.getElementById("adminConfirmOverlay");
  var btnAdminConfCancel = document.getElementById("btnAdminConfirmCancel");
  var btnAdminConfOk = document.getElementById("btnAdminConfirmOk");
  if (btnAdminConfCancel) btnAdminConfCancel.addEventListener("click", function () { closeAdminConfirm(false); });
  if (btnAdminConfOk) btnAdminConfOk.addEventListener("click", function () { closeAdminConfirm(true); });
  if (adminConfirmOv) {
    adminConfirmOv.addEventListener("click", function (e) {
      if (e.target === adminConfirmOv) closeAdminConfirm(false);
    });
  }
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    var ov = document.getElementById("adminConfirmOverlay");
    if (ov && ov.classList.contains("show")) closeAdminConfirm(false);
  });

  // Подставляем сохранённый никнейм
  var savedNick = loadSavedNickname();
  if (savedNick) document.getElementById("inNickname").value = savedNick;

  // Пробуем восстановить сессию
  if (await restoreSoloSession()) return;
  if (loadSession()) {
    await enterGameScreen();
    return;
  }

  showScreen("loginScreen");

  document.getElementById("inNickname").addEventListener("keydown", function(e) {
    if (e.key === "Enter") goToLobby();
  });
})();
