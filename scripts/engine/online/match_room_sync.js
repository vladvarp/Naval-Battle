// engine/online/match_room_sync.js

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
