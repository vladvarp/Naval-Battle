// engine/shared/entry_boards.js

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
  lobbyRooms:   [],
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
// API вынесен в scripts/engine/online/api_transport.js

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
     state.lobbyRooms = res.rooms || [];
     renderRooms(state.lobbyRooms);
   } catch(e) {
     document.getElementById("roomsList").innerHTML =
       '<div class="rooms-empty"><span class="icon">⚠</span>Ошибка подключения</div>';
   }
   startLobbyCountdown();
}

function renderRooms(rooms) {
  var list = document.getElementById("roomsList");
  var qEl = document.getElementById("roomsSearch");
  var query = qEl ? String(qEl.value || "").trim().toLowerCase() : "";
  var filtered = rooms || [];
  if (query) {
    filtered = filtered.filter(function (r) {
      var name = String(r.player1Nick || "").toLowerCase();
      var code = String(r.roomId || "").toLowerCase();
      return name.indexOf(query) !== -1 || code.indexOf(query) !== -1;
    });
  }

  if (!filtered.length) {
    list.innerHTML = '<div class="rooms-empty"><span class="icon">🌊</span>Нет открытых комнат.<br>Создайте свою!</div>';
    return;
  }
  filtered.sort(function(a, b) { return (a.idleSec || 0) - (b.idleSec || 0); });
  var html = "";
  filtered.forEach(function(r) {
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
    var isPrivate = !!r.isPrivate;
    var badgeCls = isPrivate ? "room-badge room-badge--closed" : "room-badge room-badge--open";
    var badgeText = isPrivate ? "🔒 закрытая" : "🌐 открытая";
    html += '<div class="room-item">' +
      '<div class="room-info">' +
        '<div class="room-name-row">' +
          '<div class="room-name">⚓ ' + escapeHtml(r.player1Nick) + '</div>' +
          '<span class="' + badgeCls + '">' + badgeText + '</span>' +
        '</div>' +
        '<div class="room-meta">' +
          '<span class="room-id">КОД: ' + r.roomId + '</span>' +
          '<span class="room-idle ' + idleClass + '">⏱ ' + idleText + '</span>' +
        '</div>' +
      '</div>' +
      '<button class="btn btn-primary btn-sm" style="width:auto;flex-shrink:0;" onclick="joinRoom(\'' + r.roomId + '\', \'' + escapeHtml(r.player1Nick || "") + '\', ' + (isPrivate ? "1" : "0") + ')">ВОЙТИ</button>' +
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
  var access = null;
  if (window.openOnlineRoomCreatePrompt) {
    access = await window.openOnlineRoomCreatePrompt();
  }
  if (!access) return;

  var board = await openPlacementSetup({ context: "online", defaultMode: "random" });
  if (!board) return;
  showCreateMsg("Создание комнаты...", "info");
  try {
    var res = await apiPost({
      action: "createRoom",
      nickname: state.nickname,
      shipBoard: board,
      roomType: access.type,
      password: access.password
    });
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
async function joinRoom(roomId, ownerNick, isPrivate) {
  if (!state.nickname) return;

  // ── ЗАЩИТА ОТ ВХОДА ПОД ТЕМ ЖЕ НИКОМ, ЧТО У СОЗДАТЕЛЯ ──
  if (ownerNick && 
      String(state.nickname).trim().toLowerCase() === String(ownerNick).trim().toLowerCase()) {
    
    document.getElementById("createMsg").innerHTML = 
      '<div class="message message-error">' +
      'Никнейм уже используется создателем комнаты.<br>' +
      '<strong>Нельзя войти под тем же ником!</strong>' +
      '</div>';
    return;
  }

  var password = null;
  if (isPrivate) {
    if (window.openOnlineRoomPasswordPrompt) {
      password = await window.openOnlineRoomPasswordPrompt(roomId, {
        checkFn: async function (pwd) {
          var accessRes = await apiPost({
            action: "checkRoomAccess",
            roomId: roomId,
            password: pwd
          });
          if (!accessRes || !accessRes.ok) {
            return { ok: false, error: accessRes && accessRes.error ? accessRes.error : "Неверный пароль" };
          }
          return { ok: true };
        }
      });
    }
    if (!password) return;
  }

  // Для открытых комнат всё равно проверяем доступ до расстановки (занято/удалено).
  if (!isPrivate) {
    try {
      var accessRes2 = await apiPost({ action: "checkRoomAccess", roomId: roomId });
      if (!accessRes2.ok) {
        document.getElementById("createMsg").innerHTML =
          '<div class="message message-error">' + accessRes2.error + '</div>';
        return;
      }
    } catch (e) {
      document.getElementById("createMsg").innerHTML =
        '<div class="message message-error">Ошибка подключения</div>';
      return;
    }
  }

  var board = await openPlacementSetup({ context: "online", defaultMode: "random" });
  if (!board) return;

  // Блокируем интерфейс и показываем загрузку перед входом в комнату
  lockInput("ВХОД В КОМНАТУ...");
  document.getElementById("createMsg").innerHTML =
    '<div class="message message-info">Подключение к комнате...</div>';

  try {
    var res = await apiPost({
      action: "joinRoom",
      nickname: state.nickname,
      roomId: roomId,
      shipBoard: board,
      password: password
    });
    if (!res.ok) {
      // Показываем ошибку от сервера
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
  } finally {
    unlockInput();
  }
}

// ── ЛОББИ: поиск по комнатам ───────────────────────────────────
(function initRoomsSearch() {
  var _inited = false;
  function ensure() {
    if (_inited) return;
    var qEl = document.getElementById("roomsSearch");
    if (!qEl) return;
    _inited = true;
    qEl.addEventListener("input", function () {
      renderRooms(state.lobbyRooms || []);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ensure);
  else ensure();
})();

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
  var turnsPlayer = document.getElementById("winProbTurnsPlayer");
  var turnsEnemy  = document.getElementById("winProbTurnsEnemy");
  if (!fillPlayer) return;

  fillPlayer.style.width = playerPct + "%";
  fillEnemy.style.width  = enemyPct + "%";
  divider.style.left     = playerPct + "%";
  pctPlayer.textContent  = playerPct + "%";
  pctEnemy.textContent   = enemyPct + "%";
  if (turnsPlayer) turnsPlayer.textContent = "ХОДОВ: " + enemyUntouched;
  if (turnsEnemy)  turnsEnemy.textContent  = "ХОДОВ: " + myUntouched;
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
