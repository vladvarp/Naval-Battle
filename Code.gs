// ============================================================
// МОРСКОЙ БОЙ — Google Apps Script Бэкенд v2.0
// Комнатный матчмейкинг, хранение сессий, очистка
// ============================================================

var SHEET_ROOMS   = "Rooms";    // roomId | player1Id | player1Nick | player2Id | player2Nick | shipBoard1 | shipBoard2 | phase | turn | winner | shotsP1 | shotsP2 | createdAt | lastActivity
var SHEET_LOG     = "Log";      // time | roomId | playerId | nick | x | y | result
var ROOM_TIMEOUT  = 5 * 60;     // 5 минут неактивности → удалить комнату (секунды)

// ── ОБРАБОТЧИКИ HTTP ────────────────────────────────────────────

function doGet(e) {
  var action = e.parameter.action || "";
  try {
    if (action === "state")  return jsonResp(getState(e.parameter.playerId, e.parameter.roomId));
    if (action === "lobby")  return jsonResp(getLobby());
    return jsonResp({ ok: false, error: "Неизвестное действие" });
  } catch(err) {
    return jsonResp({ ok: false, error: err.message });
  }
}

function doPost(e) {
  var data = {};
  try { data = JSON.parse(e.postData.contents); } catch(err) {
    return jsonResp({ ok: false, error: "Неверный JSON" });
  }
  var action = data.action || "";
  try {
    if (action === "join")    return jsonResp(joinLobby(data));
    if (action === "move")    return jsonResp(makeMove(data));
    if (action === "leave")   return jsonResp(leaveRoom(data));
    if (action === "newgame") return jsonResp(newGame(data));
    return jsonResp({ ok: false, error: "Неизвестное действие: " + action });
  } catch(err) {
    return jsonResp({ ok: false, error: err.message });
  }
}

function jsonResp(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── ДОСТУП К ЛИСТАМ ─────────────────────────────────────────────

function getSheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

function initSheets() {
  var rs = getSheet(SHEET_ROOMS);
  if (rs.getLastRow() === 0) {
    rs.appendRow([
      "roomId","player1Id","player1Nick","player2Id","player2Nick",
      "shipBoard1","shipBoard2","phase","turn","winner",
      "shotsP1","shotsP2","createdAt","lastActivity"
    ]);
  }
  var ls = getSheet(SHEET_LOG);
  if (ls.getLastRow() === 0) {
    ls.appendRow(["time","roomId","playerId","nick","x","y","result"]);
  }
}

// ── ГЕНЕРАТОР ID ─────────────────────────────────────────────

function genId(prefix) {
  return (prefix || "id") + "_" + Date.now() + "_" + Math.floor(Math.random() * 99999);
}

// ── ЧТЕНИЕ/ЗАПИСЬ КОМНАТ ──────────────────────────────────────────

function readAllRooms() {
  var sh   = getSheet(SHEET_ROOMS);
  var data = sh.getDataRange().getValues();
  var rooms = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (!r[0]) continue;
    var room = {
      row:         i + 1,
      roomId:      r[0],
      player1Id:   r[1],
      player1Nick: r[2],
      player2Id:   r[3],
      player2Nick: r[4],
      shipBoard1:  r[5],
      shipBoard2:  r[6],
      phase:       r[7],
      turn:        r[8],
      winner:      r[9],
      shotsP1:     [],
      shotsP2:     [],
      createdAt:   r[12],
      lastActivity: r[13]
    };
    try { room.shotsP1 = JSON.parse(r[10] || "[]"); } catch(e) { room.shotsP1 = []; }
    try { room.shotsP2 = JSON.parse(r[11] || "[]"); } catch(e) { room.shotsP2 = []; }
    rooms.push(room);
  }
  return rooms;
}

function writeRoom(room) {
  var sh = getSheet(SHEET_ROOMS);
  var row = room.row;
  sh.getRange(row, 1, 1, 14).setValues([[
    room.roomId,
    room.player1Id   || "",
    room.player1Nick || "",
    room.player2Id   || "",
    room.player2Nick || "",
    room.shipBoard1  || "",
    room.shipBoard2  || "",
    room.phase       || "waiting",
    room.turn        || "",
    room.winner      || "",
    JSON.stringify(room.shotsP1 || []),
    JSON.stringify(room.shotsP2 || []),
    room.createdAt   || new Date().toISOString(),
    new Date().toISOString()
  ]]);
}

function appendRoom(room) {
  var sh  = getSheet(SHEET_ROOMS);
  var now = new Date().toISOString();
  sh.appendRow([
    room.roomId,
    room.player1Id   || "",
    room.player1Nick || "",
    room.player2Id   || "",
    room.player2Nick || "",
    room.shipBoard1  || "",
    room.shipBoard2  || "",
    room.phase       || "waiting",
    room.turn        || "",
    room.winner      || "",
    JSON.stringify(room.shotsP1 || []),
    JSON.stringify(room.shotsP2 || []),
    now, now
  ]);
  // Return the row index for future use
  var rows = getSheet(SHEET_ROOMS).getLastRow();
  room.row = rows;
  return room;
}

function deleteRoomRow(row) {
  getSheet(SHEET_ROOMS).deleteRow(row);
}

// ── ОЧИСТКА УСТАРЕВШИХ КОМНАТ ──────────────────────────────────────
// Удаляет комнаты неактивные более ROOM_TIMEOUT секунд

function cleanupStaleRooms() {
  var rooms  = readAllRooms();
  var nowSec = Math.floor(Date.now() / 1000);
  // Удаляем снизу вверх (сохраняем индексы строк)
  for (var i = rooms.length - 1; i >= 0; i--) {
    var r = rooms[i];
    var lastTs = 0;
    try { lastTs = Math.floor(new Date(r.lastActivity).getTime() / 1000); } catch(e) {}
    if (lastTs > 0 && (nowSec - lastTs) > ROOM_TIMEOUT) {
      deleteRoomRow(r.row);
    }
  }
}

// ── ГЕНЕРАЦИЯ КОРАБЛЕЙ ──────────────────────────────────────────

function generateShips() {
  var grid = [];
  for (var r = 0; r < 10; r++) grid.push([0,0,0,0,0,0,0,0,0,0]);
  var ships = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1];
  for (var s = 0; s < ships.length; s++) {
    var size = ships[s], placed = false, attempts = 0;
    while (!placed && attempts < 1000) {
      attempts++;
      var horiz = Math.random() > 0.5;
      var row = Math.floor(Math.random() * 10);
      var col = Math.floor(Math.random() * 10);
      if (horiz) { if (col + size > 10) continue; }
      else        { if (row + size > 10) continue; }
      var canPlace = true;
      for (var d = 0; d < size && canPlace; d++) {
        var cr = horiz ? row : row + d, cc = horiz ? col + d : col;
        for (var dr = -1; dr <= 1; dr++) {
          for (var dc = -1; dc <= 1; dc++) {
            var nr = cr + dr, nc = cc + dc;
            if (nr >= 0 && nr < 10 && nc >= 0 && nc < 10 && grid[nr][nc] === 1) canPlace = false;
          }
        }
      }
      if (canPlace) {
        for (var d2 = 0; d2 < size; d2++) {
          var pr = horiz ? row : row + d2, pc = horiz ? col + d2 : col;
          grid[pr][pc] = 1;
        }
        placed = true;
      }
    }
    if (!placed) return generateShips(); // повтор при ошибке
  }
  return grid;
}

// ── ЛОББИ ─────────────────────────────────────────────────────
// Возвращает доступные комнаты (1 игрок ожидает)

function getLobby() {
  initSheets();
  cleanupStaleRooms();
  var rooms = readAllRooms();
  var available = rooms
    .filter(function(r) {
      return r.player1Id && !r.player2Id && r.phase === "waiting";
    })
    .map(function(r) {
      return { roomId: r.roomId, hostNick: r.player1Nick };
    });
  return { ok: true, rooms: available };
}

// ── ВХОД В ЛОББИ ────────────────────────────────────────────────
// Переподключение по playerId+roomId; вход в комнату; или создание новой

function joinLobby(data) {
  initSheets();
  cleanupStaleRooms();

  var nickname  = (data.nickname || "").trim();
  var playerId  = (data.playerId  || "").trim();
  var roomId    = (data.roomId    || "").trim();

  if (!nickname) return { ok: false, error: "Введите никнейм" };

  var rooms = readAllRooms();

  // ── ПЕРЕПОДКЛЮЧЕНИЕ: если playerId и roomId совпадают ──
  if (playerId && roomId) {
    for (var i = 0; i < rooms.length; i++) {
      var r = rooms[i];
      if (r.roomId !== roomId) continue;
      if (r.player1Id === playerId || r.player2Id === playerId) {
        // Обновляем время активности
        writeRoom(r);
        var slot = r.player1Id === playerId ? 1 : 2;
        return {
          ok: true, reconnected: true,
          playerId: playerId, roomId: roomId, slot: slot,
          phase: r.phase
        };
      }
    }
    // playerId не найден → создаём новую сессию
  }

  // ── ВХОД В СУЩЕСТВУЮЩУЮ КОМНАТУ (1 игрок ожидает) ──
  if (roomId) {
    for (var i = 0; i < rooms.length; i++) {
      var r = rooms[i];
      if (r.roomId !== roomId) continue;
      if (r.player2Id) return { ok: false, error: "Комната заполнена" };
      // Входим как игрок 2
      var newId  = genId("p");
      var ships2 = generateShips();
      r.player2Id   = newId;
      r.player2Nick = nickname;
      r.shipBoard2  = JSON.stringify(ships2);
      r.phase       = "playing";
      r.turn        = r.player1Id; // Первый ход у P1
      r.shotsP1     = [];
      r.shotsP2     = [];
      writeRoom(r);
      return { ok: true, playerId: newId, roomId: roomId, slot: 2, phase: "playing" };
    }
    return { ok: false, error: "Комната не найдена" };
  }

  // ── СОЗДАНИЕ НОВОЙ КОМНАТЫ ──
  var newPlayerId = genId("p");
  var ships1      = generateShips();
  var newRoomId   = genId("room");
  appendRoom({
    roomId:      newRoomId,
    player1Id:   newPlayerId,
    player1Nick: nickname,
    shipBoard1:  JSON.stringify(ships1),
    phase:       "waiting",
    shotsP1:     [],
    shotsP2:     []
  });
  return { ok: true, playerId: newPlayerId, roomId: newRoomId, slot: 1, phase: "waiting" };
}

// ── ПОЛУЧЕНИЕ СОСТОЯНИЯ ─────────────────────────────────────────────────

function getState(playerId, roomId) {
  initSheets();
  if (!playerId || !roomId) return { ok: false, error: "Отсутствует playerId или roomId" };

  var rooms = readAllRooms();
  var room = null;
  for (var i = 0; i < rooms.length; i++) {
    if (rooms[i].roomId === roomId) { room = rooms[i]; break; }
  }
  if (!room) return { ok: false, error: "Комната не найдена", roomGone: true };

  var mySlot = room.player1Id === playerId ? 1 : room.player2Id === playerId ? 2 : 0;
  if (!mySlot) return { ok: false, error: "Игрок не в этой комнате" };

  // Обновляем время активности quietly
  var sh  = getSheet(SHEET_ROOMS);
  sh.getRange(room.row, 14).setValue(new Date().toISOString());

  var result = {
    ok: true,
    phase:       room.phase,
    turn:        room.turn,
    winner:      room.winner,
    roomId:      room.roomId,
    mySlot:      mySlot,
    shotsP1:     room.shotsP1,
    shotsP2:     room.shotsP2,
    players: [
      { playerId: room.player1Id, nickname: room.player1Nick, slot: 1 },
      { playerId: room.player2Id, nickname: room.player2Nick, slot: 2 }
    ].filter(function(p) { return p.playerId; })
  };

  // Прикрепляем своё поле
  try {
    result.myBoard = JSON.parse(mySlot === 1 ? room.shipBoard1 : room.shipBoard2);
  } catch(e) { result.myBoard = null; }

  return result;
}

// ── ХОД ИГРОКА ─────────────────────────────────────────────────

function makeMove(data) {
  var playerId = data.playerId;
  var roomId   = data.roomId;
  var x        = parseInt(data.x);
  var y        = parseInt(data.y);

  if (!playerId || !roomId)          return { ok: false, error: "Отсутствуют идентификаторы" };
  if (isNaN(x) || isNaN(y))          return { ok: false, error: "Неверные координаты" };
  if (x < 0 || x > 9 || y < 0 || y > 9) return { ok: false, error: "Координаты вне поля" };

  var rooms = readAllRooms();
  var room  = null;
  for (var i = 0; i < rooms.length; i++) {
    if (rooms[i].roomId === roomId) { room = rooms[i]; break; }
  }
  if (!room)                         return { ok: false, error: "Комната не найдена" };
  if (room.phase !== "playing")      return { ok: false, error: "Игра не активна" };
  if (room.turn  !== playerId)       return { ok: false, error: "Сейчас не ваш ход" };

  var mySlot = room.player1Id === playerId ? 1 : 2;
  var shotsKey       = mySlot === 1 ? "shotsP1" : "shotsP2";
  var opponentBoard  = JSON.parse(mySlot === 1 ? room.shipBoard2 : room.shipBoard1);
  var shots          = room[shotsKey];

  // Проверка дублирующегося выстрела
  for (var i = 0; i < shots.length; i++) {
    if (shots[i].x === x && shots[i].y === y) return { ok: false, error: "В эту клетку уже стреляли" };
  }

  var cellValue = opponentBoard[y][x];
  var hit       = cellValue === 1;
  var result    = hit ? "hit" : "miss";
  var sunk      = false;

  if (hit) {
    opponentBoard[y][x] = 2;
    if (mySlot === 1) room.shipBoard2 = JSON.stringify(opponentBoard);
    else              room.shipBoard1 = JSON.stringify(opponentBoard);

    sunk = isShipSunk(opponentBoard, x, y);
    if (sunk) {
      result = "sunk";
      // Mark all cells of the sunk ship as sunk (value 3) for orange rendering
      markSunkShip(opponentBoard, x, y);
      if (mySlot === 1) room.shipBoard2 = JSON.stringify(opponentBoard);
      else              room.shipBoard1 = JSON.stringify(opponentBoard);
    }
  }

  shots.push({ x: x, y: y, result: result });
  room[shotsKey] = shots;

  // Журнал
  var logSh = getSheet(SHEET_LOG);
  var nick  = mySlot === 1 ? room.player1Nick : room.player2Nick;
  logSh.appendRow([new Date().toISOString(), roomId, playerId, nick, x, y, result]);

  // Проверка победы
  var won = isGameOver(opponentBoard);
  if (won) {
    room.phase  = "finished";
    room.winner = playerId;
    writeRoom(room);
    return { ok: true, result: result, sunk: sunk, gameOver: true, winner: playerId };
  }

  // Управление ходами: промах → передаём, попадание → оставляем
  if (!hit) {
    var opponentId = mySlot === 1 ? room.player2Id : room.player1Id;
    room.turn = opponentId;
  }

  writeRoom(room);
  return {
    ok: true, result: result, sunk: sunk, gameOver: false,
    nextTurn: hit ? playerId : (mySlot === 1 ? room.player2Id : room.player1Id)
  };
}

// ── ПОМЕТИТЬ ВЕСЬ ПОТОПЛЕННЫЙ КОРАБЛЬ (значение 3) ──────────────────

function markSunkShip(board, hitX, hitY) {
  var visited = [];
  for (var r = 0; r < 10; r++) visited.push([false,false,false,false,false,false,false,false,false,false]);

  var queue = [{x: hitX, y: hitY}];
  visited[hitY][hitX] = true;
  var cells = [];

  while (queue.length > 0) {
    var cur = queue.shift();
    cells.push(cur);
    var dirs = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
    for (var d = 0; d < dirs.length; d++) {
      var nx = cur.x + dirs[d].dx, ny = cur.y + dirs[d].dy;
      if (nx >= 0 && nx < 10 && ny >= 0 && ny < 10 && !visited[ny][nx] &&
          (board[ny][nx] === 1 || board[ny][nx] === 2)) {
        visited[ny][nx] = true;
        queue.push({x: nx, y: ny});
      }
    }
  }
  // Помечаем все клетки как потопленные (3)
  for (var i = 0; i < cells.length; i++) {
    board[cells[i].y][cells[i].x] = 3;
  }
}

// ── ПРОВЕРКА: КОРАБЛЬ ПОТОПЛЕН ──────────────────────────────────────────

function isShipSunk(board, hitX, hitY) {
  var visited = [];
  for (var r = 0; r < 10; r++) visited.push([false,false,false,false,false,false,false,false,false,false]);
  var queue = [{x: hitX, y: hitY}];
  visited[hitY][hitX] = true;
  var cells = [];

  while (queue.length > 0) {
    var cur = queue.shift();
    cells.push(cur);
    var dirs = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
    for (var d = 0; d < dirs.length; d++) {
      var nx = cur.x + dirs[d].dx, ny = cur.y + dirs[d].dy;
      if (nx >= 0 && nx < 10 && ny >= 0 && ny < 10 && !visited[ny][nx] &&
          (board[ny][nx] === 1 || board[ny][nx] === 2)) {
        visited[ny][nx] = true;
        queue.push({x: nx, y: ny});
      }
    }
  }
  for (var i = 0; i < cells.length; i++) {
    if (board[cells[i].y][cells[i].x] === 1) return false;
  }
  return true;
}

// ── ПРОВЕРКА: ИГРА ОКОНЧЕНА ──────────────────────────────────────────

function isGameOver(board) {
  for (var r = 0; r < 10; r++) for (var c = 0; c < 10; c++) if (board[r][c] === 1) return false;
  return true;
}

// ── ВЫХОД ИЗ КОМНАТЫ ────────────────────────────────────────────────

function leaveRoom(data) {
  var playerId = data.playerId, roomId = data.roomId;
  if (!playerId || !roomId) return { ok: false, error: "Отсутствуют идентификаторы" };

  var rooms = readAllRooms();
  for (var i = 0; i < rooms.length; i++) {
    var r = rooms[i];
    if (r.roomId !== roomId) continue;
    if (r.player1Id === playerId || r.player2Id === playerId) {
      deleteRoomRow(r.row);
      return { ok: true };
    }
  }
  return { ok: false, error: "Не найдено" };
}

// ── НОВАЯ ИГРА (реванш в той же комнате) ──────────────────────────

function newGame(data) {
  var playerId = data.playerId, roomId = data.roomId;
  if (!playerId || !roomId) return { ok: false, error: "Отсутствуют идентификаторы" };

  var rooms = readAllRooms();
  for (var i = 0; i < rooms.length; i++) {
    var r = rooms[i];
    if (r.roomId !== roomId) continue;
    if (r.player1Id !== playerId && r.player2Id !== playerId) continue;

    if (!r.player1Id || !r.player2Id) return { ok: false, error: "Для реванша нужны 2 игрока" };

    // Перегенерируем корабли и сбрасываем состояние
    r.shipBoard1 = JSON.stringify(generateShips());
    r.shipBoard2 = JSON.stringify(generateShips());
    r.phase      = "playing";
    r.turn       = r.player1Id;
    r.winner     = "";
    r.shotsP1    = [];
    r.shotsP2    = [];
    writeRoom(r);
    return { ok: true, message: "Новая игра начата" };
  }
  return { ok: false, error: "Комната не найдена" };
}