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
      createdAt:    resolveRoomCreatedAt(data[i][0], data[i][13], data[i][6]),
      winner:       data[i][9] || "",
      roomType:     data[i][11] || "open",
      passHash:     data[i][12] || ""
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
  // Очищаем перед удалением чтобы не оставалось артефактов
  sheet.getRange(row, 1, 1, sheet.getLastColumn()).clearContent();
  sheet.deleteRow(row);
}

function updateRoomActivity(row) {
  writeRoomField(row, 7, new Date().toISOString());
}

// ── УДАЛЕНИЕ УСТАРЕВШИХ КОМНАТ (LAZY CLEANUP) ───────────────
function cleanupOldRooms(roomTimeoutMs) {
  var timeoutMs = resolveRoomTimeoutMs(roomTimeoutMs);
  var sheet = getSheet(SHEET_NAME_ROOMS);
  var data  = sheet.getDataRange().getValues();
  var now   = Date.now();
  // Удаляем снизу вверх чтобы не сбивать индексы строк
  for (var i = data.length - 1; i >= 1; i--) {
    if (!data[i][0]) continue;
    var phase = data[i][5];
    // waiting: считаем от момента создания комнаты, а не от последней активности создателя.
    var baseTime = (phase === "waiting")
      ? resolveRoomCreatedAt(data[i][0], data[i][13], data[i][6])
      : data[i][6];
    if (!baseTime) continue;
    var baseMs = new Date(baseTime).getTime();
    if (now - baseMs > timeoutMs) {
      var roomId = data[i][0];
      deletePlayersOfRoom(roomId);
      // Очищаем перед удалением
      sheet.getRange(i + 1, 1, 1, sheet.getLastColumn()).clearContent();
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
  var totalCols = sheet.getLastColumn();
  // Удаляем снизу вверх; очищаем перед удалением — исправление бага с lastSeen
  for (var i = data.length - 1; i >= 1; i--) {
    if (data[i][2] === roomId) {
      sheet.getRange(i + 1, 1, 1, totalCols).clearContent();
      sheet.deleteRow(i + 1);
    }
  }
}

function removePlayerRow(row) {
  var sheet = getSheet(SHEET_NAME_PLAYERS);
  // Очищаем содержимое строки перед удалением — исправление бага с зависшей ячейкой lastSeen
  var totalCols = sheet.getLastColumn();
  sheet.getRange(row, 1, 1, totalCols).clearContent();
  sheet.deleteRow(row);
}

function updatePlayerLastSeen(row) {
  getSheet(SHEET_NAME_PLAYERS).getRange(row, 6).setValue(new Date().toISOString());
}

// ── СПИСОК КОМНАТ (ЛОББИ) ────────────────────────────────────
function getRooms(roomTimeoutMs) {
  initSheets();
  cleanupOldRooms(roomTimeoutMs);
  var rooms = readRooms();
  var now   = Date.now();
  var result = [];
  for (var i = 0; i < rooms.length; i++) {
    var r = rooms[i];
    if (r.phase !== "waiting") continue;
    var lastMs = r.createdAt ? new Date(r.createdAt).getTime() : 0;
    var idleSec = Math.floor((now - lastMs) / 1000);
    var roomType = (r.roomType === "closed") ? "closed" : "open";
    result.push({
      roomId:       r.roomId,
      player1Nick:  r.player1Nick,
      idleSec:      idleSec,
      createdAt:    r.createdAt,
      lastActivity: r.lastActivity,
      roomType:     roomType,
      isPrivate:    roomType === "closed"
    });
  }
  return { ok: true, rooms: result };
}

// ── СОЗДАТЬ КОМНАТУ ──────────────────────────────────────────
function createRoom(data, roomTimeoutMs) {
  initSheets();
  cleanupOldRooms(roomTimeoutMs);

  var nickname = (data.nickname || "").trim();
  if (!nickname) return { ok: false, error: "Введите никнейм" };

  var roomType = (data.roomType === "closed") ? "closed" : "open";
  var password = (data.password || "");
  if (roomType === "closed") {
    if (String(password).trim().length < 4) return { ok: false, error: "Пароль комнаты должен быть не короче 4 символов" };
  } else {
    password = "";
  }
  var passHash = password ? _hashPassword(password) : "";

  var roomId   = generateRoomId();
  var playerId = generateId();
  var ships    = resolvePlayerShips(data);
  var now      = new Date().toISOString();

  // Создаём комнату
  var roomSheet = getSheet(SHEET_NAME_ROOMS);
  var newRoomRow = (roomSheet.getLastRow() || 1) + 1;
  roomSheet.appendRow([roomId, playerId, nickname, "", "", "waiting", now, "[]", "[]", "", "", roomType, passHash, now]);
  _styleNewRow(roomSheet, newRoomRow, 14);

  // Добавляем игрока
  var playerSheet = getSheet(SHEET_NAME_PLAYERS);
  var newPlayerRow = (playerSheet.getLastRow() || 1) + 1;
  playerSheet.appendRow([playerId, nickname, roomId, 1, JSON.stringify(ships), now]);
  _styleNewRow(playerSheet, newPlayerRow, 6);

  return { ok: true, playerId: playerId, roomId: roomId, slot: 1 };
}

// ── ПРОВЕРИТЬ ДОСТУП К КОМНАТЕ (без входа) ─────────────────────
function checkRoomAccess(data, roomTimeoutMs) {
  initSheets();
  cleanupOldRooms(roomTimeoutMs);

  var roomId   = (data.roomId || "").trim();
  var password = (data.password || "");
  if (!roomId) return { ok: false, error: "Не указан roomId" };

  var room = findRoom(roomId);
  if (!room) return { ok: false, error: "Комната не найдена или устарела" };
  if (room.phase !== "waiting") return { ok: false, error: "Комната уже занята или игра началась" };
  if (room.player2Id) return { ok: false, error: "Комната уже заполнена" };

  var roomType = (room.roomType === "closed") ? "closed" : "open";
  if (roomType === "closed") {
    if (String(password).trim().length < 4) return { ok: false, error: "Нужен пароль комнаты" };
    if (!_safeEquals(_hashPassword(password), room.passHash || "")) return { ok: false, error: "Неверный пароль комнаты" };
  }

  return { ok: true, roomId: roomId, roomType: roomType };
}

// ── ВОЙТИ В КОМНАТУ ──────────────────────────────────────────
function joinRoom(data, roomTimeoutMs) {
  initSheets();
  cleanupOldRooms(roomTimeoutMs);

  var nickname = (data.nickname || "").trim();
  var roomId   = (data.roomId   || "").trim();
  var password = (data.password || "");

  if (!nickname) return { ok: false, error: "Введите никнейм" };
  if (!roomId)   return { ok: false, error: "Укажите ID комнаты" };

  var room = findRoom(roomId);
  if (!room) return { ok: false, error: "Комната не найдена или устарела" };
  if (room.phase !== "waiting") return { ok: false, error: "Комната уже занята или игра началась" };
  if (room.player2Id) return { ok: false, error: "Комната уже заполнена" };
  var roomType = (room.roomType === "closed") ? "closed" : "open";

  // Переподключение (тот же никнейм — игрок 1 переподключается)
  if (room.player1Nick === nickname) {
    var existingPlayer = findPlayerById(room.player1Id);
    if (existingPlayer) {
      updatePlayerLastSeen(existingPlayer.row);
      return { ok: true, playerId: existingPlayer.playerId, roomId: roomId, slot: 1, reconnected: true, phase: room.phase };
    }
  }

  if (roomType === "closed") {
    if (String(password).trim().length < 4) return { ok: false, error: "Нужен пароль комнаты" };
    if (!_safeEquals(_hashPassword(password), room.passHash || "")) return { ok: false, error: "Неверный пароль комнаты" };
  }

  var playerId = generateId();
  var ships    = resolvePlayerShips(data);
  var now      = new Date().toISOString();

  // Добавляем второго игрока
  var playerSheet = getSheet(SHEET_NAME_PLAYERS);
  var newPlayerRow = (playerSheet.getLastRow() || 1) + 1;
  playerSheet.appendRow([playerId, nickname, roomId, 2, JSON.stringify(ships), now]);
  _styleNewRow(playerSheet, newPlayerRow, 6);

  // Обновляем комнату
  var roomSheet = getSheet(SHEET_NAME_ROOMS);
  var roomData  = roomSheet.getDataRange().getValues();
  for (var i = 1; i < roomData.length; i++) {
    if (roomData[i][0] === roomId) {
      var targetRow = i + 1;
      roomSheet.getRange(targetRow, 4).setValue(playerId);
      roomSheet.getRange(targetRow, 5).setValue(nickname);
      roomSheet.getRange(targetRow, 6).setValue("playing");
      roomSheet.getRange(targetRow, 7).setValue(now);
      setTurn(targetRow, room.player1Id);
      break;
    }
  }

  return { ok: true, playerId: playerId, roomId: roomId, slot: 2, phase: "playing" };
}