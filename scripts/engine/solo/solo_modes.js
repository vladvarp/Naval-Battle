// engine/solo/solo_modes.js

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

  // Ход сохраняется в localStorage при каждом промахе/передаче — доверяем ему.
  // determineSoloCurrentTurn — только запас для старых сохранений без поля turn.
  var inferredTurn = determineSoloCurrentTurn();
  solo.turn = (s.turn === "player" || s.turn === "ai") ? s.turn : inferredTurn;
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

// Определение хода для старых сохранений без поля turn. Учитывает только «настоящие»
// выстрелы: синтетические угловые промахи (auto) не считаются — иначе после попадания
// последней записью в shotsP*n оказывается промах и ход ошибочно уходит компьютеру.
function determineSoloCurrentTurn() {
  function substantive(shots) {
    return shots.filter(function (s) { return !s.auto; });
  }
  var p1 = substantive(solo.shotsP1);
  var p2 = substantive(solo.shotsP2);
  if (p1.length === 0 && p2.length === 0) return "player";

  var next = "player"; // партия всегда начинается с хода человека
  var i = 0, j = 0;
  while (i < p1.length || j < p2.length) {
    if (next === "player") {
      if (i >= p1.length) return "player";
      var rs = p1[i++];
      if (rs.result === "miss") next = "ai";
    } else {
      if (j >= p2.length) return "ai";
      var as = p2[j++];
      if (as.result === "miss") next = "player";
    }
  }
  return next === "player" ? "player" : "ai";
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
    // Сразу фиксируем смену хода при промахе — иначе F5 во время сообщения сохранит неверный turn
    if (result.type === "miss") solo.turn = "ai";
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
  // Сразу фиксируем ход после промаха ИИ — иначе F5 перед концом задержки сохранит turn: ai
  if (result.type === "miss") solo.turn = "player";
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
    // Передаём ход игроку (turn уже сохранён сразу после промаха)
    await sleepMs(SFX_DELAY + 1400);
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
