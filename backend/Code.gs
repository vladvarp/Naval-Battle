// ============================================================
// МОРСКОЙ БОЙ — Google Apps Script Backend
// Версия: 2.0 — Система комнат
// Все комментарии на русском языке
// ============================================================

// ── НАСТРОЙКИ ──────────────────────────────────────────────
var ADMIN_PASSWORD      = "kokos666";
var SHEET_NAME_ROOMS    = "Комнаты";
var SHEET_NAME_PLAYERS  = "Игроки";
var SHEET_NAME_STATE    = "Состояние";
var SHEET_NAME_LOG      = "Журнал";
var ROOM_TIMEOUT_MS     = 10 * 60 * 1000; // 10 минут бездействия

// ── ОБРАБОТЧИК GET-ЗАПРОСОВ ─────────────────────────────────
function doGet(e) {
  var action = e.parameter.action || "";
  try {
    if (action === "state")    return jsonResponse(getState(e.parameter.playerId, e.parameter.roomId));
    if (action === "getRooms") return jsonResponse(getRooms());
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
    if (action === "createRoom") return jsonResponse(createRoom(data));
    if (action === "joinRoom")   return jsonResponse(joinRoom(data));
    if (action === "move")       return jsonResponse(makeMove(data));
    if (action === "restart")    return jsonResponse(restartGame(data));
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
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

// ── ИНИЦИАЛИЗАЦИЯ СТРУКТУРЫ ТАБЛИЦЫ ────────────────────────
function initSheets() {
  // Лист комнат: roomId | player1Id | player1Nick | player2Id | player2Nick | phase | lastActivity | shotsP1 | shotsP2 | winner | turn
  var rs = getSheet(SHEET_NAME_ROOMS);
  if (rs.getLastRow() === 0) {
    rs.appendRow(["roomId","player1Id","player1Nick","player2Id","player2Nick","phase","lastActivity","shotsP1","shotsP2","winner","turn"]);
  }

  // Лист игроков: playerId | nickname | roomId | slot | shipBoard | lastSeen
  var ps = getSheet(SHEET_NAME_PLAYERS);
  if (ps.getLastRow() === 0) {
    ps.appendRow(["playerId","nickname","roomId","slot","shipBoard","lastSeen"]);
  }

  // Лист журнала: время | roomId | playerId | nickname | x | y | результат
  var ls = getSheet(SHEET_NAME_LOG);
  if (ls.getLastRow() === 0) {
    ls.appendRow(["время","roomId","playerId","nickname","x","y","результат"]);
  }
}

// ── ГЕНЕРАЦИЯ УНИКАЛЬНОГО ID ────────────────────────────────
function generateId() {
  return "id_" + Date.now() + "_" + Math.floor(Math.random() * 9999);
}

function generateRoomId() {
  var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  var id = "";
  for (var i = 0; i < 5; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

// ── ГЕНЕРАЦИЯ РАССТАНОВКИ КОРАБЛЕЙ ──────────────────────────
function generateShips() {
  var grid = [];
  for (var r = 0; r < 10; r++) grid.push([0,0,0,0,0,0,0,0,0,0]);

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

      if (horiz) { if (col + size > 10) continue; }
      else       { if (row + size > 10) continue; }

      var canPlace = true;
      for (var d = 0; d < size && canPlace; d++) {
        var cr = horiz ? row     : row + d;
        var cc = horiz ? col + d : col;
        for (var dr = -1; dr <= 1; dr++) {
          for (var dc = -1; dc <= 1; dc++) {
            var nr = cr + dr, nc = cc + dc;
            if (nr >= 0 && nr < 10 && nc >= 0 && nc < 10 && grid[nr][nc] === 1) canPlace = false;
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
    if (!placed) return generateShips();
  }
  return grid;
}

// ── РАБОТА С КОМНАТАМИ ──────────────────────────────────────
function readRooms() {
  var sheet = getSheet(SHEET_NAME_ROOMS);
  var data  = sheet.getDataRange().getValues();
  var rooms = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    var room = {
      row:          i + 1,
      roomId:       data[i][0],
      player1Id:    data[i][1],
      player1Nick:  data[i][2],
      player2Id:    data[i][3],
      player2Nick:  data[i][4],
      phase:        data[i][5],
      lastActivity: data[i][6],
      winner:       data[i][9] || ""
    };
    try { room.shotsP1 = JSON.parse(data[i][7] || "[]"); } catch(e) { room.shotsP1 = []; }
    try { room.shotsP2 = JSON.parse(data[i][8] || "[]"); } catch(e) { room.shotsP2 = []; }
    rooms.push(room);
  }
  return rooms;
}

function findRoom(roomId) {
  var rooms = readRooms();
  for (var i = 0; i < rooms.length; i++) {
    if (rooms[i].roomId === roomId) return rooms[i];
  }
  return null;
}

function writeRoomField(row, colIndex, value) {
  var sheet = getSheet(SHEET_NAME_ROOMS);
  sheet.getRange(row, colIndex).setValue(
    typeof value === "object" ? JSON.stringify(value) : value
  );
}

function deleteRoomRow(row) {
  var sheet = getSheet(SHEET_NAME_ROOMS);
  sheet.deleteRow(row);
}

function updateRoomActivity(row) {
  writeRoomField(row, 7, new Date().toISOString());
}

// ── УДАЛЕНИЕ УСТАРЕВШИХ КОМНАТ (LAZY CLEANUP) ───────────────
function cleanupOldRooms() {
  var sheet = getSheet(SHEET_NAME_ROOMS);
  var data  = sheet.getDataRange().getValues();
  var now   = Date.now();
  // Удаляем снизу вверх чтобы не сбивать индексы строк
  for (var i = data.length - 1; i >= 1; i--) {
    if (!data[i][0]) continue;
    var lastActivity = data[i][6];
    if (!lastActivity) continue;
    var lastMs = new Date(lastActivity).getTime();
    if (now - lastMs > ROOM_TIMEOUT_MS) {
      // Удаляем игроков этой комнаты
      var roomId = data[i][0];
      deletePlayersOfRoom(roomId);
      sheet.deleteRow(i + 1);
    }
  }
}

// ── РАБОТА С ИГРОКАМИ ───────────────────────────────────────
function readPlayers() {
  var sheet = getSheet(SHEET_NAME_PLAYERS);
  var data  = sheet.getDataRange().getValues();
  var players = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    players.push({
      row:       i + 1,
      playerId:  data[i][0],
      nickname:  data[i][1],
      roomId:    data[i][2],
      slot:      data[i][3],
      shipBoard: data[i][4] || "",
      lastSeen:  data[i][5]
    });
  }
  return players;
}

function readPlayersOfRoom(roomId) {
  var all = readPlayers();
  return all.filter(function(p){ return p.roomId === roomId; });
}

function findPlayerById(playerId) {
  var players = readPlayers();
  for (var i = 0; i < players.length; i++) {
    if (players[i].playerId === playerId) return players[i];
  }
  return null;
}

function deletePlayersOfRoom(roomId) {
  var sheet = getSheet(SHEET_NAME_PLAYERS);
  var data  = sheet.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (data[i][2] === roomId) sheet.deleteRow(i + 1);
  }
}

function removePlayerRow(row) {
  getSheet(SHEET_NAME_PLAYERS).deleteRow(row);
}

function updatePlayerLastSeen(row) {
  getSheet(SHEET_NAME_PLAYERS).getRange(row, 6).setValue(new Date().toISOString());
}

// ── СПИСОК КОМНАТ (ЛОББИ) ────────────────────────────────────
function getRooms() {
  initSheets();
  cleanupOldRooms();
  var rooms = readRooms();
  var now   = Date.now();
  var result = [];
  for (var i = 0; i < rooms.length; i++) {
    var r = rooms[i];
    // Показываем только комнаты в ожидании второго игрока
    if (r.phase !== "waiting") continue;
    var lastMs = r.lastActivity ? new Date(r.lastActivity).getTime() : 0;
    var idleSec = Math.floor((now - lastMs) / 1000);
    result.push({
      roomId:      r.roomId,
      player1Nick: r.player1Nick,
      idleSec:     idleSec,
      lastActivity: r.lastActivity
    });
  }
  return { ok: true, rooms: result };
}

// ── СОЗДАТЬ КОМНАТУ ──────────────────────────────────────────
function createRoom(data) {
  initSheets();
  cleanupOldRooms();

  var nickname = (data.nickname || "").trim();
  if (!nickname) return { ok: false, error: "Введите никнейм" };

  var roomId   = generateRoomId();
  var playerId = generateId();
  var ships    = generateShips();
  var now      = new Date().toISOString();

  // Создаём комнату
  var roomSheet = getSheet(SHEET_NAME_ROOMS);
  roomSheet.appendRow([roomId, playerId, nickname, "", "", "waiting", now, "[]", "[]", ""]);

  // Добавляем игрока
  var playerSheet = getSheet(SHEET_NAME_PLAYERS);
  playerSheet.appendRow([playerId, nickname, roomId, 1, JSON.stringify(ships), now]);

  return { ok: true, playerId: playerId, roomId: roomId, slot: 1 };
}

// ── ВОЙТИ В КОМНАТУ ──────────────────────────────────────────
function joinRoom(data) {
  initSheets();
  cleanupOldRooms();

  var nickname = (data.nickname || "").trim();
  var roomId   = (data.roomId   || "").trim();

  if (!nickname) return { ok: false, error: "Введите никнейм" };
  if (!roomId)   return { ok: false, error: "Укажите ID комнаты" };

  var room = findRoom(roomId);
  if (!room) return { ok: false, error: "Комната не найдена или устарела" };
  if (room.phase !== "waiting") return { ok: false, error: "Комната уже занята или игра началась" };
  if (room.player2Id) return { ok: false, error: "Комната уже заполнена" };

  // Переподключение (тот же никнейм — игрок 1 переподключается)
  if (room.player1Nick === nickname) {
    var existingPlayer = findPlayerById(room.player1Id);
    if (existingPlayer) {
      updatePlayerLastSeen(existingPlayer.row);
      return { ok: true, playerId: existingPlayer.playerId, roomId: roomId, slot: 1, reconnected: true, phase: room.phase };
    }
  }

  var playerId = generateId();
  var ships    = generateShips();
  var now      = new Date().toISOString();

  // Добавляем второго игрока
  var playerSheet = getSheet(SHEET_NAME_PLAYERS);
  playerSheet.appendRow([playerId, nickname, roomId, 2, JSON.stringify(ships), now]);

  // Обновляем комнату: записываем player2, меняем фазу на playing
  var roomSheet = getSheet(SHEET_NAME_ROOMS);
  var roomData  = roomSheet.getDataRange().getValues();
  for (var i = 1; i < roomData.length; i++) {
    if (roomData[i][0] === roomId) {
      var targetRow = i + 1;
      roomSheet.getRange(targetRow, 4).setValue(playerId);
      roomSheet.getRange(targetRow, 5).setValue(nickname);
      roomSheet.getRange(targetRow, 6).setValue("playing");
      roomSheet.getRange(targetRow, 7).setValue(now);
      
      // === ИСПРАВЛЕНИЕ ===
      // Первый игрок (slot 1) всегда начинает
      setTurn(targetRow, room.player1Id);
      
      break;
    }
  }

  return { ok: true, playerId: playerId, roomId: roomId, slot: 2, phase: "playing" };
}

// ── ПОЛУЧЕНИЕ СОСТОЯНИЯ ИГРЫ ────────────────────────────────
function getState(playerId, roomId) {
  initSheets();
  cleanupOldRooms();

  if (!roomId) return { ok: false, error: "Не указан roomId" };

  var room = findRoom(roomId);
  if (!room) return { ok: false, error: "Комната не найдена" };

  // Обновляем lastSeen игрока
  if (playerId) {
    var me = findPlayerById(playerId);
    if (me) {
      updatePlayerLastSeen(me.row);
      // Обновляем активность комнаты
      updateRoomActivity(room.row);
    }
  }

  var players = readPlayersOfRoom(roomId);
  var playersPublic = players.map(function(p) {
    return { playerId: p.playerId, nickname: p.nickname, slot: p.slot };
  });

  // Определяем чей ход: всегда слот 1 начинает, ход передаётся через shotsP1/shotsP2
  var turn = determineTurn(room);

  var result = {
    ok:      true,
    roomId:  roomId,
    phase:   room.phase,
    turn:    turn,
    winner:  room.winner,
    players: playersPublic,
    shotsP1: room.shotsP1,
    shotsP2: room.shotsP2
  };

  // Добавляем собственное поле кораблей
  if (playerId) {
    var myPlayer = players.filter(function(p){ return p.playerId === playerId; })[0];
    if (myPlayer) {
      try { result.myBoard = JSON.parse(myPlayer.shipBoard); } catch(e) { result.myBoard = null; }
      result.mySlot = myPlayer.slot;
    }
  }

  return result;
}

// ── ОПРЕДЕЛЕНИЕ ЧЬЕГО ХОДА ──────────────────────────────────
// Слот 1 ходит первым. При промахе ход переходит. При попадании — снова тот же.
// Читаем из поля turn комнаты (хранится playerId)
function determineTurn(room) {
  // turn хранится в колонке 10 (индекс 9 в данных) — нам нужен отдельный механизм
  // Используем отдельную колонку — читаем прямо из таблицы
  var sheet = getSheet(SHEET_NAME_ROOMS);
  var data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === room.roomId) {
      return data[i][10] || ""; // колонка 11 — turn (playerId)
    }
  }
  return "";
}

function setTurn(roomRow, playerId) {
  var sheet = getSheet(SHEET_NAME_ROOMS);
  // Убеждаемся что колонка 11 существует
  sheet.getRange(roomRow, 11).setValue(playerId);
}

// ── ХОД ИГРОКА ──────────────────────────────────────────────
function makeMove(data) {
  var playerId = data.playerId;
  var roomId   = data.roomId;
  var x        = parseInt(data.x);
  var y        = parseInt(data.y);

  if (!playerId)              return { ok: false, error: "Нет playerId" };
  if (!roomId)                return { ok: false, error: "Нет roomId" };
  if (isNaN(x) || isNaN(y))  return { ok: false, error: "Неверные координаты" };
  if (x < 0 || x > 9 || y < 0 || y > 9) return { ok: false, error: "Координаты вне поля" };

  var room = findRoom(roomId);
  if (!room) return { ok: false, error: "Комната не найдена" };
  if (room.phase !== "playing") return { ok: false, error: "Игра не идёт" };

  var turn = determineTurn(room);
  if (turn !== playerId) return { ok: false, error: "Сейчас не ваш ход" };

  var players = readPlayersOfRoom(roomId);
  var shooter  = players.filter(function(p){ return p.playerId === playerId; })[0];
  if (!shooter) return { ok: false, error: "Игрок не найден" };

  var opponent = players.filter(function(p){ return p.playerId !== playerId; })[0];
  if (!opponent) return { ok: false, error: "Противник не найден" };

  var shotsKey = shooter.slot === 1 ? "shotsP1" : "shotsP2";
  var shots    = room[shotsKey];

  // Проверяем: уже стреляли в эту клетку?
  for (var i = 0; i < shots.length; i++) {
    if (shots[i].x === x && shots[i].y === y) {
      return { ok: false, error: "В эту клетку уже стреляли" };
    }
  }

  // Читаем корабли противника
  var opponentBoard;
  try { opponentBoard = JSON.parse(opponent.shipBoard); }
  catch(e) { return { ok: false, error: "Ошибка данных противника" }; }

  var cellValue = opponentBoard[y][x];
  var hit = cellValue === 1;
  var result = hit ? "hit" : "miss";

  // Информация о потопленном корабле
  var sunkCells = [];
  var sunkPerimeter = [];
  var sunk = false;

  if (hit) {
    opponentBoard[y][x] = 2;
    // Обновляем поле противника
    var opSheet = getSheet(SHEET_NAME_PLAYERS);
    var opData  = opSheet.getDataRange().getValues();
    for (var r = 1; r < opData.length; r++) {
      if (opData[r][0] === opponent.playerId) {
        opSheet.getRange(r + 1, 5).setValue(JSON.stringify(opponentBoard));
        break;
      }
    }

    var sunkResult = checkShipSunk(opponentBoard, x, y);
    sunk = sunkResult.sunk;
    if (sunk) {
      result = "sunk";
      sunkCells     = sunkResult.cells;
      sunkPerimeter = sunkResult.perimeter;
    }
  }

  // Добавляем выстрел в массив
  var shotObj = { x: x, y: y, result: result };
  if (sunk) {
    shotObj.sunkCells     = sunkCells;
    shotObj.sunkPerimeter = sunkPerimeter;
  }
  shots.push(shotObj);

  // Обновляем выстрелы в таблице комнат
  var roomSheet = getSheet(SHEET_NAME_ROOMS);
  var roomData  = roomSheet.getDataRange().getValues();
  for (var ri = 1; ri < roomData.length; ri++) {
    if (roomData[ri][0] === roomId) {
      var shotsColIdx = shooter.slot === 1 ? 8 : 9; // колонки 8 и 9 (1-based)
      roomSheet.getRange(ri + 1, shotsColIdx).setValue(JSON.stringify(shots));
      roomSheet.getRange(ri + 1, 7).setValue(new Date().toISOString()); // lastActivity
      break;
    }
  }

  // Записываем в журнал
  var logSheet = getSheet(SHEET_NAME_LOG);
  logSheet.appendRow([new Date().toISOString(), roomId, playerId, shooter.nickname, x, y, result]);

  // Проверяем победу
  var won = isGameOver(opponentBoard);
  if (won) {
    var roomSheetW = getSheet(SHEET_NAME_ROOMS);
    var roomDataW  = roomSheetW.getDataRange().getValues();
    for (var wi = 1; wi < roomDataW.length; wi++) {
      if (roomDataW[wi][0] === roomId) {
        roomSheetW.getRange(wi + 1, 6).setValue("finished");
        roomSheetW.getRange(wi + 1, 10).setValue(playerId);
        break;
      }
    }
    return { ok: true, result: result, sunk: sunk, sunkCells: sunkCells, sunkPerimeter: sunkPerimeter, gameOver: true, winner: playerId };
  }

  // Управление очерёдью
  var roomRow = null;
  var roomDataT = getSheet(SHEET_NAME_ROOMS).getDataRange().getValues();
  for (var ti = 1; ti < roomDataT.length; ti++) {
    if (roomDataT[ti][0] === roomId) { roomRow = ti + 1; break; }
  }
  if (roomRow) {
    var nextTurn = hit ? playerId : opponent.playerId;
    setTurn(roomRow, nextTurn);
  }

  return {
    ok: true,
    result: result,
    sunk: sunk,
    sunkCells: sunkCells,
    sunkPerimeter: sunkPerimeter,
    gameOver: false,
    nextTurn: hit ? playerId : opponent.playerId
  };
}

// ── ПРОВЕРКА: УНИЧТОЖЕН ЛИ КОРАБЛЬ — возвращает клетки и периметр ──
function checkShipSunk(board, hitX, hitY) {
  // Flood-fill для нахождения всех клеток корабля
  var visited = [];
  for (var r = 0; r < 10; r++) visited.push([false,false,false,false,false,false,false,false,false,false]);

  var queue = [{x: hitX, y: hitY}];
  var cells = [];
  visited[hitY][hitX] = true;

  while (queue.length > 0) {
    var cur = queue.shift();
    cells.push(cur);
    var dirs = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
    for (var d = 0; d < dirs.length; d++) {
      var nx = cur.x + dirs[d].dx;
      var ny = cur.y + dirs[d].dy;
      if (nx >= 0 && nx < 10 && ny >= 0 && ny < 10 && !visited[ny][nx] &&
          (board[ny][nx] === 1 || board[ny][nx] === 2)) {
        visited[ny][nx] = true;
        queue.push({x: nx, y: ny});
      }
    }
  }

  // Проверяем: все клетки корабля подбиты?
  for (var i = 0; i < cells.length; i++) {
    if (board[cells[i].y][cells[i].x] === 1) return { sunk: false, cells: [], perimeter: [] };
  }

  // Корабль потоплен — вычисляем периметр
  var cellSet = {};
  cells.forEach(function(c){ cellSet[c.y + "_" + c.x] = true; });

  var perimeter = [];
  var perimSet  = {};
  cells.forEach(function(c) {
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        if (dy === 0 && dx === 0) continue;
        var nx = c.x + dx, ny = c.y + dy;
        if (nx < 0 || nx > 9 || ny < 0 || ny > 9) continue;
        var key = ny + "_" + nx;
        if (!cellSet[key] && !perimSet[key]) {
          perimSet[key] = true;
          perimeter.push({x: nx, y: ny});
        }
      }
    }
  });

  return { sunk: true, cells: cells, perimeter: perimeter };
}

// ── ПРОВЕРКА: ИГРА ЗАВЕРШЕНА? ────────────────────────────────
function isGameOver(board) {
  for (var r = 0; r < 10; r++)
    for (var c = 0; c < 10; c++)
      if (board[r][c] === 1) return false;
  return true;
}

// ── ЯВНЫЙ ВЫХОД ИГРОКА ────────────────────────────────────
function leaveGame(data) {
  var playerId = data.playerId;
  var roomId   = data.roomId;
  if (!playerId) return { ok: false, error: "Нет playerId" };

  var me = findPlayerById(playerId);
  if (me) removePlayerRow(me.row);

  if (roomId) {
    var room = findRoom(roomId);
    if (room && room.phase === "playing") {
      // Переводим комнату обратно в waiting
      var sheet = getSheet(SHEET_NAME_ROOMS);
      var data2 = sheet.getDataRange().getValues();
      for (var i = 1; i < data2.length; i++) {
        if (data2[i][0] === roomId) {
          sheet.getRange(i + 1, 6).setValue("waiting");
          // Очищаем второго игрока если это он выходит
          if (room.player2Id === playerId) {
            sheet.getRange(i + 1, 4).setValue("");
            sheet.getRange(i + 1, 5).setValue("");
          }
          sheet.getRange(i + 1, 8).setValue("[]");
          sheet.getRange(i + 1, 9).setValue("[]");
          sheet.getRange(i + 1, 10).setValue("");
          sheet.getRange(i + 1, 11).setValue("");
          sheet.getRange(i + 1, 7).setValue(new Date().toISOString());
          break;
        }
      }
    } else if (room && room.phase === "waiting") {
      // Первый игрок вышел из ожидания — удаляем комнату
      deletePlayersOfRoom(roomId);
      var sheet2 = getSheet(SHEET_NAME_ROOMS);
      var data3  = sheet2.getDataRange().getValues();
      for (var j = data3.length - 1; j >= 1; j--) {
        if (data3[j][0] === roomId) { sheet2.deleteRow(j + 1); break; }
      }
    }
  }

  return { ok: true, message: "Вы вышли из игры" };
}

// ── ПЕРЕЗАПУСК ИГРЫ (ADMIN) ──────────────────────────────────
function restartGame(data) {
  var password = (data.password || "").trim();
  var roomId   = data.roomId;
  if (password !== ADMIN_PASSWORD) return { ok: false, error: "Неверный пароль" };

  if (roomId) {
    // Перезапустить конкретную комнату: удалить её и всех игроков
    deletePlayersOfRoom(roomId);
    var sheet = getSheet(SHEET_NAME_ROOMS);
    var data2 = sheet.getDataRange().getValues();
    for (var i = data2.length - 1; i >= 1; i--) {
      if (data2[i][0] === roomId) { sheet.deleteRow(i + 1); break; }
    }
    return { ok: true, message: "Комната удалена" };
  }

  // Без roomId — очистить всё
  var rs = getSheet(SHEET_NAME_ROOMS);
  var rLast = rs.getLastRow();
  if (rLast > 1) rs.deleteRows(2, rLast - 1);

  var ps = getSheet(SHEET_NAME_PLAYERS);
  var pLast = ps.getLastRow();
  if (pLast > 1) ps.deleteRows(2, pLast - 1);

  return { ok: true, message: "Все комнаты удалены" };
}