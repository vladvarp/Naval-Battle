// ============================================================
// МОРСКОЙ БОЙ — Google Apps Script Backend
// Версия: 1.0
// Все комментарии на русском языке
// ============================================================

// ── НАСТРОЙКИ ──────────────────────────────────────────────
var ADMIN_PASSWORD = "kokos666";       // Пароль для принудительного входа
var SHEET_NAME_PLAYERS  = "Игроки";   // Название листа с игроками
var SHEET_NAME_STATE    = "Состояние";// Название листа с состоянием игры
var SHEET_NAME_LOG      = "Журнал";   // Название листа журнала ходов

// ── ОБРАБОТЧИК GET-ЗАПРОСОВ ─────────────────────────────────
function doGet(e) {
  var action = e.parameter.action || "";
  try {
    if (action === "state") {
      return jsonResponse(getState(e.parameter.playerId));
    }
    return jsonResponse({ ok: false, error: "Неизвестное действие" });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// ── ОБРАБОТЧИК POST-ЗАПРОСОВ ────────────────────────────────
function doPost(e) {
  var data = {};
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse({ ok: false, error: "Неверный JSON" });
  }

  var action = data.action || "";
  try {
    if (action === "join")          return jsonResponse(joinGame(data));
    if (action === "forceJoin")   return jsonResponse(forceJoin(data));
    if (action === "move")       return jsonResponse(makeMove(data));
    if (action === "restart")    return jsonResponse(restartGame(data));
    if (action === "acceptTakeover") return jsonResponse(acceptTakeover(data));
    if (action === "denyTakeover")  return jsonResponse(denyTakeover(data));
    if (action === "leave")      return jsonResponse(leaveGame(data));
    return jsonResponse({ ok: false, error: "Неизвестное действие: " + action });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// ── ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ: JSON-ответ ────────────────────
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── ПОЛУЧЕНИЕ ЛИСТОВ ТАБЛИЦЫ ────────────────────────────────
function getSheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}

// ── ИНИЦИАЛИЗАЦИЯ СТРУКТУРЫ ТАБЛИЦЫ ────────────────────────
function initSheets() {
  // Лист игроков: playerId | nickname | slot | shipBoard | lastSeen
  var ps = getSheet(SHEET_NAME_PLAYERS);
  if (ps.getLastRow() === 0) {
    ps.appendRow(["playerId", "nickname", "slot", "shipBoard", "lastSeen"]);
  }

  // Лист состояния: ключ | значение
  var ss = getSheet(SHEET_NAME_STATE);
  if (ss.getLastRow() === 0) {
    ss.appendRow(["ключ", "значение"]);
    ss.appendRow(["phase",    "waiting"]);  // waiting | playing | finished
    ss.appendRow(["turn",     ""]);         // playerId чья очередь
    ss.appendRow(["winner",   ""]);         // playerId победителя
    ss.appendRow(["shotsP1",  "[]"]);       // выстрелы игрока 1 по полю игрока 2
    ss.appendRow(["shotsP2",  "[]"]);       // выстрелы игрока 2 по полю игрока 1
    ss.appendRow(["pendingTakeover", ""]);   // playerId который хочет занять место
    ss.appendRow(["takeoverSlot",   ""]);   // слот который хотят занять
    ss.appendRow(["takeoverExpiresAt", ""]);// Unix timestamp когда истекает
  }

  // Лист журнала: время | playerId | nickname | x | y | результат
  var ls = getSheet(SHEET_NAME_LOG);
  if (ls.getLastRow() === 0) {
    ls.appendRow(["время", "playerId", "nickname", "x", "y", "результат"]);
  }
}

// ── РАБОТА СО СОСТОЯНИЕМ ────────────────────────────────────
function readState() {
  var sheet = getSheet(SHEET_NAME_STATE);
  var data  = sheet.getDataRange().getValues();
  var state = {};
  for (var i = 1; i < data.length; i++) {
    var key = data[i][0];
    var val = data[i][1];
    state[key] = val;
  }
  // Парсим JSON-поля
  try { state.shotsP1 = JSON.parse(state.shotsP1 || "[]"); } catch(e) { state.shotsP1 = []; }
  try { state.shotsP2 = JSON.parse(state.shotsP2 || "[]"); } catch(e) { state.shotsP2 = []; }
  return state;
}

function writeStateKey(key, value) {
  var sheet = getSheet(SHEET_NAME_STATE);
  var data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(
        typeof value === "object" ? JSON.stringify(value) : value
      );
      return;
    }
  }
  // Если ключа нет — добавляем
  sheet.appendRow([key, typeof value === "object" ? JSON.stringify(value) : value]);
}

// ── РАБОТА С ИГРОКАМИ ───────────────────────────────────────
function readPlayers() {
  var sheet = getSheet(SHEET_NAME_PLAYERS);
  var data  = sheet.getDataRange().getValues();
  var players = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    var p = {
      row:       i + 1,
      playerId:  data[i][0],
      nickname:  data[i][1],
      slot:      data[i][2],
      shipBoard: "",
      lastSeen:  data[i][4]
    };
    try { p.shipBoard = data[i][3]; } catch(e) { p.shipBoard = ""; }
    players.push(p);
  }
  return players;
}

function findPlayerById(playerId) {
  var players = readPlayers();
  for (var i = 0; i < players.length; i++) {
    if (players[i].playerId === playerId) return players[i];
  }
  return null;
}

function updatePlayerRow(row, nickname, slot, shipBoard, lastSeen) {
  var sheet = getSheet(SHEET_NAME_PLAYERS);
  sheet.getRange(row, 2).setValue(nickname);
  sheet.getRange(row, 3).setValue(slot);
  sheet.getRange(row, 4).setValue(shipBoard);
  sheet.getRange(row, 5).setValue(lastSeen);
}

function removePlayerRow(row) {
  var sheet = getSheet(SHEET_NAME_PLAYERS);
  sheet.deleteRow(row);
}

// ── ГЕНЕРАЦИЯ УНИКАЛЬНОГО ID ────────────────────────────────
function generateId() {
  return "p_" + Date.now() + "_" + Math.floor(Math.random() * 9999);
}

// ── ГЕНЕРАЦИЯ РАССТАНОВКИ КОРАБЛЕЙ ──────────────────────────
// Возвращает двумерный массив 10x10
// 0 = вода, 1 = корабль
function generateShips() {
  var grid = [];
  for (var r = 0; r < 10; r++) {
    grid.push([0,0,0,0,0,0,0,0,0,0]);
  }

  // Стандартный набор: 1×4, 2×3, 3×2, 4×1
  var ships = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1];

  for (var s = 0; s < ships.length; s++) {
    var size = ships[s];
    var placed = false;
    var attempts = 0;
    while (!placed && attempts < 1000) {
      attempts++;
      var horiz = Math.random() > 0.5;
      var row = Math.floor(Math.random() * 10);
      var col = Math.floor(Math.random() * 10);

      if (horiz) {
        if (col + size > 10) continue;
      } else {
        if (row + size > 10) continue;
      }

      // Проверка: можно ли поставить корабль (с учётом отступа)
      var canPlace = true;
      for (var d = 0; d < size && canPlace; d++) {
        var cr = horiz ? row     : row + d;
        var cc = horiz ? col + d : col;
        for (var dr = -1; dr <= 1; dr++) {
          for (var dc = -1; dc <= 1; dc++) {
            var nr = cr + dr;
            var nc = cc + dc;
            if (nr >= 0 && nr < 10 && nc >= 0 && nc < 10) {
              if (grid[nr][nc] === 1) { canPlace = false; }
            }
          }
        }
      }

      if (canPlace) {
        for (var d2 = 0; d2 < size; d2++) {
          var pr = horiz ? row     : row + d2;
          var pc = horiz ? col + d2 : col;
          grid[pr][pc] = 1;
        }
        placed = true;
      }
    }
    if (!placed) {
      // Перегенерируем всё если не смогли разместить
      return generateShips();
    }
  }
  return grid;
}

// ── ВХОД В ИГРУ ─────────────────────────────────────────────
function joinGame(data) {
  initSheets();
  var nickname = (data.nickname || "").trim();
  if (!nickname) return { ok: false, error: "Введите никнейм" };

  var players = readPlayers();
  var state = readState();

  // Если игрок уже в игре (переподключение)
  for (var i = 0; i < players.length; i++) {
    if (players[i].nickname === nickname) {
      var now = new Date().toISOString();
      updatePlayerRow(players[i].row, players[i].nickname, players[i].slot,
                      players[i].shipBoard, now);
      return {
        ok: true,
        playerId: players[i].playerId,
        slot: players[i].slot,
        reconnected: true,
        phase: state.phase
      };
    }
  }

  // Определяем свободный слот (ищем слот без игрока)
  var usedSlots = players.map(function(p) { return p.slot; });
  var freeSlot = usedSlots.indexOf(1) === -1 ? 1 : usedSlots.indexOf(2) === -1 ? 2 : 0;

  // Если уже 2 игрока - проверяем занятость слотов
  if (players.length >= 2 && freeSlot === 0) {
    // Проверяем если есть ожидающий захват
    var pendingId = state.pendingTakeover || "";
    var expireAt = parseInt(state.takeoverExpiresAt) || 0;
    var nowSec = Math.floor(Date.now() / 1000);

    // Если есть активное предложение и оно ещё не истекло
    if (pendingId && expireAt > nowSec) {
      return { 
        ok: false, 
        error: "Идёт попытка захвата. Подождите...", 
        pendingTakeover: true 
      };
    }

    // Все слоты заняты - предлагаем захватить место
    // Если никто не хочет захватывать - ошибка
    return { 
      ok: false, 
      error: "Игра заполнена. Используйте пароль для принудительного входа." 
    };
  }

  // Если есть ожидающий захват и слот свободен - обрабатываем
  var pendingId = state.pendingTakeover || "";
  var expireAt = parseInt(state.takeoverExpiresAt) || 0;
  var nowSec = Math.floor(Date.now() / 1000);
  var targetSlot = parseInt(state.takeoverSlot) || 0;

  // Если есть активное предложение - проверяем
  if (pendingId && expireAt > nowSec && targetSlot > 0) {
    // Предложение активно - новый игрок не может присоединиться
    return { 
      ok: false, 
      error: "Идёт попытка занять место. Подождите " + (expireAt - nowSec) + "с...", 
      pendingTakeover: true,
      takeoverSlot: targetSlot,
      takeoverExpiresAt: expireAt
    };
  }

  // Используем свободный слот или слот из предложения
  var slot = targetSlot > 0 && state.pendingTakeover ? targetSlot : freeSlot;

  // Очищаем предложение захвата если было
  if (state.pendingTakeover) {
    writeStateKey("pendingTakeover", "");
    writeStateKey("takeoverSlot", "");
    writeStateKey("takeoverExpiresAt", "");
  }

  var playerId  = generateId();
  var ships     = generateShips();
  var shipStr   = JSON.stringify(ships);
  var now       = new Date().toISOString();

  var sheet = getSheet(SHEET_NAME_PLAYERS);
  sheet.appendRow([playerId, nickname, slot, shipStr, now]);

  // Обновляем состояние игры
  var updatedPlayers = readPlayers();
  if (updatedPlayers.length === 2) {
    // Игра начинается — первый ход у слота 1
    var p1 = updatedPlayers.filter(function(p){ return p.slot === 1; })[0];
    writeStateKey("phase", "playing");
    writeStateKey("turn",  p1.playerId);
    writeStateKey("winner", "");
    writeStateKey("shotsP1", []);
    writeStateKey("shotsP2", []);
  }

  return { ok: true, playerId: playerId, slot: slot, phase: "waiting" };
}

// ── ПРИНУДИТЕЛЬНЫЙ ВХОД (ADMIN) ─────────────────────────────
function forceJoin(data) {
  initSheets();
  var nickname = (data.nickname || "").trim();
  var password = (data.password || "").trim();
  var kickSlot = parseInt(data.kickSlot) || 0;  // 1 или 2

  if (!nickname)                       return { ok: false, error: "Введите никнейм" };
  if (password !== ADMIN_PASSWORD)     return { ok: false, error: "Неверный пароль" };
  if (kickSlot !== 1 && kickSlot !== 2) return { ok: false, error: "Укажите слот для кика (1 или 2)" };

  var players = readPlayers();
  var target  = players.filter(function(p){ return p.slot === kickSlot; })[0];

  if (!target) return { ok: false, error: "Слот " + kickSlot + " свободен" };

  // Удаляем целевого игрока
  removePlayerRow(target.row);

  // Добавляем нового игрока на освободившийся слот
  var playerId = generateId();
  var ships    = generateShips();
  var shipStr  = JSON.stringify(ships);
  var now      = new Date().toISOString();

  var sheet = getSheet(SHEET_NAME_PLAYERS);
  sheet.appendRow([playerId, nickname, kickSlot, shipStr, now]);

  // Сбрасываем очередь если шла игра
  var state = readState();
  if (state.phase === "playing") {
    var updatedPlayers = readPlayers();
    var p1 = updatedPlayers.filter(function(p){ return p.slot === 1; })[0];
    if (p1) {
      writeStateKey("turn", p1.playerId);
    }
    writeStateKey("shotsP1", []);
    writeStateKey("shotsP2", []);
    writeStateKey("phase", "playing");
    writeStateKey("winner", "");
  }

  return {
    ok: true,
    playerId: playerId,
    slot: kickSlot,
    kicked: target.nickname
  };
}

// ── ХОД ИГРОКА ──────────────────────────────────────────────
function makeMove(data) {
  var playerId = data.playerId;
  var x        = parseInt(data.x);  // 0–9
  var y        = parseInt(data.y);  // 0–9

  if (!playerId)                return { ok: false, error: "Нет playerId" };
  if (isNaN(x) || isNaN(y))     return { ok: false, error: "Неверные координаты" };
  if (x < 0 || x > 9 || y < 0 || y > 9) return { ok: false, error: "Координаты вне поля" };

  var state   = readState();
  var players = readPlayers();

  if (state.phase !== "playing") return { ok: false, error: "Игра не идёт" };
  if (state.turn  !== playerId)  return { ok: false, error: "Сейчас не ваш ход" };

  var shooter = findPlayerById(playerId);
  if (!shooter) return { ok: false, error: "Игрок не найден" };

  // Находим противника
  var opponent = players.filter(function(p){ return p.playerId !== playerId; })[0];
  if (!opponent) return { ok: false, error: "Противник не найден" };

  // Определяем массив выстрелов текущего игрока
  var shotsKey = shooter.slot === 1 ? "shotsP1" : "shotsP2";
  var shots    = state[shotsKey];

  // Проверяем: уже стреляли в эту клетку?
  for (var i = 0; i < shots.length; i++) {
    if (shots[i].x === x && shots[i].y === y) {
      return { ok: false, error: "В эту клетку уже стреляли" };
    }
  }

  // Читаем корабли противника
  var opponentBoard;
  try {
    opponentBoard = JSON.parse(opponent.shipBoard);
  } catch(e) {
    return { ok: false, error: "Ошибка данных противника" };
  }

  // Определяем результат выстрела
  var cellValue = opponentBoard[y][x];
  var hit = cellValue === 1;
  var result = hit ? "hit" : "miss";

  // Проверяем: уничтожен ли корабль полностью?
  var sunk = false;
  if (hit) {
    // Помечаем клетку как подбитую (2)
    opponentBoard[y][x] = 2;
    // Обновляем поле противника в таблице
    var opSheet = getSheet(SHEET_NAME_PLAYERS);
    var opData  = opSheet.getDataRange().getValues();
    for (var r = 1; r < opData.length; r++) {
      if (opData[r][0] === opponent.playerId) {
        opSheet.getRange(r + 1, 4).setValue(JSON.stringify(opponentBoard));
        break;
      }
    }
    sunk = isShipSunk(opponentBoard, x, y);
    if (sunk) result = "sunk";
  }

  // Добавляем выстрел в массив
  shots.push({ x: x, y: y, result: result });
  writeStateKey(shotsKey, shots);

  // Записываем в журнал
  var logSheet = getSheet(SHEET_NAME_LOG);
  logSheet.appendRow([new Date().toISOString(), playerId, shooter.nickname, x, y, result]);

  // Проверяем победу
  var won = isGameOver(opponentBoard);
  if (won) {
    writeStateKey("phase",  "finished");
    writeStateKey("winner", playerId);
    return { ok: true, result: result, sunk: sunk, gameOver: true, winner: playerId };
  }

  // Управление очерёдью:
  // Если попадание — стреляет снова (BLOCK_NEXT логика)
  // Если промах — передаём ход противнику (ALLOW_NEXT логика)
  if (!hit) {
    writeStateKey("turn", opponent.playerId);
  }
  // При попадании turn остаётся у текущего игрока

  return {
    ok: true,
    result: result,
    sunk: sunk,
    gameOver: false,
    nextTurn: hit ? playerId : opponent.playerId
  };
}

// ── ПРОВЕРКА: УНИЧТОЖЕН ЛИ КОРАБЛЬ ─────────────────────────
function isShipSunk(board, hitX, hitY) {
  // Находим все клетки корабля через flood-fill по горизонтали/вертикали
  // Клетка считается частью корабля если она 1 или 2

  // Сначала определяем принадлежность клетки к кораблю
  // Ищем связные клетки (1 или 2) через 4-связность
  var visited = [];
  for (var r = 0; r < 10; r++) visited.push([false,false,false,false,false,false,false,false,false,false]);

  var queue   = [{x: hitX, y: hitY}];
  var cells   = [];
  visited[hitY][hitX] = true;

  while (queue.length > 0) {
    var cur = queue.shift();
    cells.push(cur);
    var dirs = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
    for (var d = 0; d < dirs.length; d++) {
      var nx = cur.x + dirs[d].dx;
      var ny = cur.y + dirs[d].dy;
      if (nx >= 0 && nx < 10 && ny >= 0 && ny < 10 &&
          !visited[ny][nx] &&
          (board[ny][nx] === 1 || board[ny][nx] === 2)) {
        visited[ny][nx] = true;
        queue.push({x: nx, y: ny});
      }
    }
  }

  // Если все клетки корабля = 2 (подбиты) — потоплен
  for (var i = 0; i < cells.length; i++) {
    if (board[cells[i].y][cells[i].x] === 1) return false; // есть целые клетки
  }
  return true;
}

// ── ПРОВЕРКА: ИГРА ЗАВЕРШЕНА? ────────────────────────────────
function isGameOver(board) {
  for (var r = 0; r < 10; r++) {
    for (var c = 0; c < 10; c++) {
      if (board[r][c] === 1) return false; // есть целые клетки кораблей
    }
  }
  return true;
}

// ── ЗАПРОС НА ЗАХВАТ МЕСТА ────────────────────────────────
function requestTakeover(data) {
  initSheets();
  var nickname = (data.nickname || "").trim();
  var targetSlot = parseInt(data.slot) || 0;

  if (!nickname) return { ok: false, error: "Введите никнейм" };
  if (targetSlot !== 1 && targetSlot !== 2) return { ok: false, error: "Укажите слот 1 или 2" };

  var players = readPlayers();
  var state = readState();

  // Проверяем занят ли слот
  var currentPlayer = players.filter(function(p){ return p.slot === targetSlot; })[0];
  if (!currentPlayer) {
    // Слот свободен - просто занимаем
    var playerId = generateId();
    var ships = generateShips();
    var shipStr = JSON.stringify(ships);
    var now = new Date().toISOString();

    var sheet = getSheet(SHEET_NAME_PLAYERS);
    sheet.appendRow([playerId, nickname, targetSlot, shipStr, now]);

    var updatedPlayers = readPlayers();
    if (updatedPlayers.length === 2) {
      var p1 = updatedPlayers.filter(function(p){ return p.slot === 1; })[0];
      writeStateKey("phase", "playing");
      writeStateKey("turn",  p1.playerId);
      writeStateKey("winner", "");
      writeStateKey("shotsP1", []);
      writeStateKey("shotsP2", []);
    }

    return { ok: true, playerId: playerId, slot: targetSlot };
  }

  // Слот занят - проверяем истекло ли предыдущее предложение
  var pendingId = state.pendingTakeover || "";
  var expireAt = parseInt(state.takeoverExpiresAt) || 0;
  var nowSec = Math.floor(Date.now() / 1000);

  // Если предложение ещё активно - отклоняем
  if (pendingId && expireAt > nowSec) {
    return { 
      ok: false, 
      error: "Другой игрок уже пробует занять это место", 
      pendingTakeover: true,
      takeoverSlot: targetSlot,
      takeoverExpiresAt: expireAt,
      currentPlayer: currentPlayer.nickname
    };
  }

  // Создаём новое предложение о захвате
  var takeoverId = generateId();
  var expiresAt = nowSec + 5; // 5 секунд

  writeStateKey("pendingTakeover", takeoverId);
  writeStateKey("takeoverSlot", targetSlot);
  writeStateKey("takeoverExpiresAt", expiresAt.toString());

  return {
    ok: true,
    takeoverRequested: true,
    playerId: takeoverId,
    slot: targetSlot,
    expiresAt: expiresAt,
    currentPlayer: currentPlayer.nickname,
    message: "Ожидание ответа от текущего игрока..."
  };
}

// ── ПРИНЯТЬ ЗАХВАТ ───────────────────────────────────────────
function acceptTakeover(data) {
  var playerId = data.playerId;
  if (!playerId) return { ok: false, error: "Нет playerId" };

  var players = readPlayers();
  var state = readState();
  var nowSec = Math.floor(Date.now() / 1000);

  // Проверяем актуальность предложения
  var pendingId = state.pendingTakeover || "";
  var expireAt = parseInt(state.takeoverExpiresAt) || 0;

  if (pendingId !== playerId || expireAt <= nowSec) {
    // Предложение истекло или неверное
    clearPendingTakeover();
    return { ok: false, error: "Время вышло или запрос недействителен" };
  }

  // Получаем данные предложения
  var targetSlot = parseInt(state.takeoverSlot) || 0;

  // Находим текущего игрока на этом слоте
  var currentPlayer = players.filter(function(p){ return p.slot === targetSlot; })[0];
  if (!currentPlayer) {
    clearPendingTakeover();
    return { ok: false, error: "Слот уже свободен" };
  }

  // Удаляем текущего игрока
  removePlayerRow(currentPlayer.row);

  // Очищаем предложение
  clearPendingTakeover();

  // Добавляем нового игрока
  var newId = generateId();
  var ships = generateShips();
  var shipStr = JSON.stringify(ships);
  var now = new Date().toISOString();

  var sheet = getSheet(SHEET_NAME_PLAYERS);
  sheet.appendRow([newId, data.nickname || "Новый игрок", targetSlot, shipStr, now]);

  // Сбрасываем игру если она была в процессе
  if (state.phase === "playing") {
    var updatedPlayers = readPlayers();
    var p1 = updatedPlayers.filter(function(p){ return p.slot === 1; })[0];
    if (p1) {
      writeStateKey("turn", p1.playerId);
    }
    writeStateKey("shotsP1", []);
    writeStateKey("shotsP2", []);
    writeStateKey("phase", "playing");
    writeStateKey("winner", "");
  }

  return {
    ok: true,
    slot: targetSlot,
    playerId: newId,
    kicked: currentPlayer.nickname,
    message: "Вы заняли место игрока " + currentPlayer.nickname
  };
}

// ── ОТКЛОНИТЬ ЗАХВАТ ────────────────────────────────────────
function denyTakeover(data) {
  var playerId = data.playerId;
  if (!playerId) return { ok: false, error: "Нет playerId" };

  var state = readState();
  var nowSec = Math.floor(Date.now() / 1000);

  // Проверяем актуальность предложения
  var pendingId = state.pendingTakeover || "";
  var expireAt = parseInt(state.takeoverExpiresAt) || 0;

  if (pendingId !== playerId || expireAt <= nowSec) {
    clearPendingTakeover();
    return { ok: false, error: "Время вышло или запрос недействителен" };
  }

  // Просто очищаем предложение
  clearPendingTakeover();

  return {
    ok: true,
    message: "Вы отклонили запрос на захват"
  };
}

// ── ЯВНЫЙ ВЫХОД ИГРОКА ────────────────────────────────────
function leaveGame(data) {
  var playerId = data.playerId;
  if (!playerId) return { ok: false, error: "Нет playerId" };

  var players = readPlayers();
  var me = players.filter(function(p){ return p.playerId === playerId; })[0];

  if (!me) return { ok: false, error: "Игрок не найден" };

  // Удаляем игрока
  removePlayerRow(me.row);

  // Очищаем состояние если игра была
  var state = readState();
  if (state.phase === "playing") {
    writeStateKey("phase", "waiting");
    writeStateKey("turn", "");
    writeStateKey("shotsP1", []);
    writeStateKey("shotsP2", []);
  }

  // Очищаем предложение захвата
  clearPendingTakeover();

  return { ok: true, message: "Вы вышли из игры" };
}

// ── ОЧИСТИТЬ ПРЕДЛОЖЕНИЕ ЗАХВАТА ───────────────────────
function clearPendingTakeover() {
  writeStateKey("pendingTakeover", "");
  writeStateKey("takeoverSlot", "");
  writeStateKey("takeoverExpiresAt", "");
}

// ── ПОЛУЧЕНИЕ СОСТОЯНИЯ ИГРЫ ────────────────────────────────
function getState(playerId) {
  initSheets();
  var state   = readState();
  var players = readPlayers();
  var nowSec = Math.floor(Date.now() / 1000);

  // Проверяем и очищаем истекшие предложения
  var expireAt = parseInt(state.takeoverExpiresAt) || 0;
  if (state.pendingTakeover && expireAt > 0 && expireAt <= nowSec) {
    writeStateKey("pendingTakeover", "");
    writeStateKey("takeoverSlot", "");
    writeStateKey("takeoverExpiresAt", "");
    state.pendingTakeover = "";
    state.takeoverSlot = "";
    state.takeoverExpiresAt = "";
  }

  // Публичная информация об игроках
  var playersPublic = players.map(function(p) {
    return { playerId: p.playerId, nickname: p.nickname, slot: p.slot };
  });

  var result = {
    ok:      true,
    phase:   state.phase,
    turn:    state.turn,
    winner:  state.winner,
    players: playersPublic,
    shotsP1: state.shotsP1,
    shotsP2: state.shotsP2
  };

  // Добавляем информацию о захвате если есть активное предложение
  if (state.pendingTakeover && expireAt > nowSec) {
    result.pendingTakeover = {
      pendingTakeover: state.pendingTakeover,
      slot: parseInt(state.takeoverSlot),
      expiresAt: expireAt
    };
  }

  // Добавляем собственное поле кораблей если playerId передан
  if (playerId) {
    var me = players.filter(function(p){ return p.playerId === playerId; })[0];
    if (me) {
      try {
        result.myBoard = JSON.parse(me.shipBoard);
      } catch(e) {
        result.myBoard = null;
      }
      result.mySlot = me.slot;
    }
  }

  return result;
}

// ── ПЕРЕЗАПУСК ИГРЫ ─────────────────────────────────────────
function restartGame(data) {
  var password = (data.password || "").trim();
  if (password !== ADMIN_PASSWORD) return { ok: false, error: "Неверный пароль" };

  // Очищаем игроков
  var ps = getSheet(SHEET_NAME_PLAYERS);
  var lastRow = ps.getLastRow();
  if (lastRow > 1) {
    ps.deleteRows(2, lastRow - 1);
  }

  // Сбрасываем состояние
  writeStateKey("phase",   "waiting");
  writeStateKey("turn",    "");
  writeStateKey("winner",  "");
  writeStateKey("shotsP1", []);
  writeStateKey("shotsP2", []);

  return { ok: true, message: "Игра перезапущена" };
}
