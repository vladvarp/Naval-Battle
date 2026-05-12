// ── ПОЛУЧЕНИЕ СОСТОЯНИЯ ИГРЫ ────────────────────────────────
function getState(playerId, roomId, roomTimeoutMs) {
  initSheets();
  cleanupOldRooms(roomTimeoutMs);

  if (!roomId) return { ok: false, error: "Не указан roomId" };

  var room = findRoom(roomId);
  if (!room) return { ok: false, error: "Комната не найдена" };

  if (playerId) {
    var me = findPlayerById(playerId);
    if (me) {
      updatePlayerLastSeen(me.row);
      updateRoomActivity(room.row);
    }
  }

  var players = readPlayersOfRoom(roomId);
  var playersPublic = players.map(function(p) {
    return { playerId: p.playerId, nickname: p.nickname, slot: p.slot };
  });

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
function determineTurn(room) {
  var sheet = getSheet(SHEET_NAME_ROOMS);
  var data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === room.roomId) {
      return data[i][10] || "";
    }
  }
  return "";
}

function setTurn(roomRow, playerId) {
  var sheet = getSheet(SHEET_NAME_ROOMS);
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

  var sunkCells = [];
  var sunkPerimeter = [];
  var sunk = false;

  if (hit) {
    opponentBoard[y][x] = 2;
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
      var shotsColIdx = shooter.slot === 1 ? 8 : 9;
      roomSheet.getRange(ri + 1, shotsColIdx).setValue(JSON.stringify(shots));
      roomSheet.getRange(ri + 1, 7).setValue(new Date().toISOString());
      break;
    }
  }

  // Записываем в журнал выстрелов
  var logSheet = getSheet(SHEET_NAME_LOG);
  var newLogRow = (logSheet.getLastRow() || 1) + 1;
  logSheet.appendRow([
    new Date().toLocaleString("ru-RU"),
    roomId,
    playerId,
    shooter.nickname,
    formatShotColumnForLog(x),
    formatShotRowForLog(y),
    result
  ]);
  _styleNewRow(logSheet, newLogRow, 7);

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
    // Записываем в историю игр
    _logGameHistory(room, shooter, opponent, shots);

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

// ── ЗАПИСЬ В ИСТОРИЮ ИГР ────────────────────────────────────
function _logGameHistory(room, winner, loser, winnerShots) {
  try {
    var sheet = getSheet(SHEET_NAME_HISTORY);
    var now   = new Date();

    // Длительность: от момента создания комнаты.
    var startMs = room.createdAt ? new Date(room.createdAt).getTime() : now.getTime();
    var durationMin = Math.round((now.getTime() - startMs) / 60000);

    // Кол-во выстрелов
    var loserShotsKey = loser.slot === 1 ? "shotsP1" : "shotsP2";
    var loserShots = room[loserShotsKey] ? room[loserShotsKey].length : 0;

    var newRow = (sheet.getLastRow() || 1) + 1;
    sheet.appendRow([
      now.toLocaleString("ru-RU"),
      room.roomId,
      winner.nickname,
      loser.nickname,
      winnerShots.length,
      loserShots,
      durationMin,
      "Потоплены все корабли"
    ]);

    // Стиль новой строки — золотая для победителя
    var rng = sheet.getRange(newRow, 1, 1, 8);
    var bg = (newRow % 2 === 0) ? CLR.SEAFOAM : CLR.WHITE;
    rng.setBackground(bg)
       .setFontColor(CLR.DARK_TEXT)
       .setFontSize(9)
       .setVerticalAlignment("middle");
    // Выделяем ник победителя золотым
    sheet.getRange(newRow, 3)
         .setBackground(CLR.GOLD)
         .setFontWeight("bold")
         .setFontColor(CLR.DARK_TEXT);
    sheet.setRowHeight(newRow, 24);

    // Обновляем статистику
    _updateStats(winner.nickname, loser.nickname, winnerShots.length);
  } catch(e) {}
}

// ── ЗАПИСЬ ТУРНИРНОЙ ТАБЛИЦЫ ИЗ АГРЕГАТА ─────────────────────
// statsMap: ник → { games, wins, losses, totalWinShots }
function _writeStatsFromMap(statsMap) {
  var sheet = getSheet(SHEET_NAME_STATS);
  // Данные начинаются с 4-й строки (1=баннер, 2=подзаголовок, 3=шапка)
  var DATA_START = 4;
  var lastRow = sheet.getLastRow();

  var sorted = [];
  for (var n in statsMap) {
    if (statsMap.hasOwnProperty(n)) {
      var s = statsMap[n];
      sorted.push({
        nick: n,
        games: s.games,
        wins: s.wins,
        losses: s.losses,
        winPct: s.games > 0 ? Math.round((s.wins / s.games) * 100) : 0,
        avgShots: s.wins > 0 ? Math.round(s.totalWinShots / s.wins) : 0
      });
    }
  }
  sorted.sort(function(a, b) {
    if (b.wins !== a.wins) return b.wins - a.wins;
    return b.winPct - a.winPct;
  });

  if (lastRow >= DATA_START) {
    sheet.getRange(DATA_START, 1, lastRow - DATA_START + 1, 7).clearContent();
    sheet.getRange(DATA_START, 1, lastRow - DATA_START + 1, 7).clearFormat();
  }

  for (var j = 0; j < sorted.length; j++) {
    var rowNum = DATA_START + j;
    var entry = sorted[j];
    var medal = j === 0 ? "🥇" : j === 1 ? "🥈" : j === 2 ? "🥉" : String(j + 1);
    sheet.getRange(rowNum, 1, 1, 7).setValues([[
      medal,
      entry.nick,
      entry.games,
      entry.wins,
      entry.losses,
      entry.winPct + "%",
      entry.avgShots
    ]]);

    var rowBg = j === 0 ? CLR.GOLD : (j % 2 === 0 ? CLR.SEAFOAM : CLR.WHITE);
    var rowBold = j === 0;
    sheet.getRange(rowNum, 1, 1, 7)
         .setBackground(rowBg)
         .setFontColor(CLR.DARK_TEXT)
         .setFontSize(9)
         .setFontWeight(rowBold ? "bold" : "normal")
         .setHorizontalAlignment("center")
         .setVerticalAlignment("middle");
    sheet.setRowHeight(rowNum, 26);
  }
}

// ── ПЕРЕСЧЁТ СТАТИСТИКИ ИЗ ЛИСТА «ИСТОРИЯ ИГР» ───────────────
function rebuildStatsFromHistory() {
  try {
    var historySheet = getSheet(SHEET_NAME_HISTORY);
    var lastRow = historySheet.getLastRow();
    var statsMap = {};
    if (lastRow >= 2) {
      var values = historySheet.getRange(2, 1, lastRow, 8).getValues();
      for (var i = 0; i < values.length; i++) {
        var row = values[i];
        var winNick = String(row[2] || "").trim();
        var loseNick = String(row[3] || "").trim();
        var winShots = parseInt(row[4], 10);
        if (isNaN(winShots)) winShots = 0;
        if (!winNick || !loseNick) continue;
        if (!statsMap[winNick]) statsMap[winNick] = { games: 0, wins: 0, losses: 0, totalWinShots: 0 };
        if (!statsMap[loseNick]) statsMap[loseNick] = { games: 0, wins: 0, losses: 0, totalWinShots: 0 };
        statsMap[winNick].games++;
        statsMap[winNick].wins++;
        statsMap[winNick].totalWinShots += winShots;
        statsMap[loseNick].games++;
        statsMap[loseNick].losses++;
      }
    }
    _writeStatsFromMap(statsMap);
  } catch (e) {}
}

// ── ОБНОВЛЕНИЕ СТАТИСТИКИ ────────────────────────────────────
function _updateStats(winnerNick, loserNick, winnerShotCount) {
  try {
    var sheet = getSheet(SHEET_NAME_STATS);
    var DATA_START = 4;
    var lastRow = sheet.getLastRow();

    var statsMap = {};
    if (lastRow >= DATA_START) {
      var existing = sheet.getRange(DATA_START, 1, lastRow - DATA_START + 1, 7).getValues();
      for (var i = 0; i < existing.length; i++) {
        var nick = existing[i][1];
        if (!nick) continue;
        var w = existing[i][3] || 0;
        statsMap[nick] = {
          games:   existing[i][2] || 0,
          wins:    w,
          losses:  existing[i][4] || 0,
          totalWinShots: w > 0 ? (existing[i][6] || 0) * w : 0
        };
      }
    }

    if (!statsMap[winnerNick]) statsMap[winnerNick] = { games: 0, wins: 0, losses: 0, totalWinShots: 0 };
    statsMap[winnerNick].games++;
    statsMap[winnerNick].wins++;
    statsMap[winnerNick].totalWinShots += winnerShotCount;

    if (!statsMap[loserNick]) statsMap[loserNick] = { games: 0, wins: 0, losses: 0, totalWinShots: 0 };
    statsMap[loserNick].games++;
    statsMap[loserNick].losses++;

    _writeStatsFromMap(statsMap);
  } catch(e) {}
}

// ── ПРОВЕРКА: УНИЧТОЖЕН ЛИ КОРАБЛЬ ──────────────────────────
function checkShipSunk(board, hitX, hitY) {
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

  for (var i = 0; i < cells.length; i++) {
    if (board[cells[i].y][cells[i].x] === 1) return { sunk: false, cells: [], perimeter: [] };
  }

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

// ── ЯВНЫЙ ВЫХОД ИГРОКА ──────────────────────────────────────
function leaveGame(data, roomTimeoutMs) {
  var playerId = data.playerId;
  var roomId   = data.roomId;
  if (!playerId) return { ok: false, error: "Нет playerId" };

  var me = findPlayerById(playerId);
  if (me) removePlayerRow(me.row);

  if (roomId) {
    var room = findRoom(roomId);
    if (room && room.phase === "playing") {
      var sheet = getSheet(SHEET_NAME_ROOMS);
      var data2 = sheet.getDataRange().getValues();
      for (var i = 1; i < data2.length; i++) {
        if (data2[i][0] === roomId) {
          sheet.getRange(i + 1, 6).setValue("waiting");
          if (room.player2Id === playerId) {
            sheet.getRange(i + 1, 4).setValue("");
            sheet.getRange(i + 1, 5).setValue("");
          }
          sheet.getRange(i + 1, 8).setValue("[]");
          sheet.getRange(i + 1, 9).setValue("[]");
          sheet.getRange(i + 1, 10).setValue("");
          sheet.getRange(i + 1, 11).setValue("");
          sheet.getRange(i + 1, 7).setValue(new Date().toISOString());
          sheet.getRange(i + 1, 14).setValue(new Date().toISOString());
          break;
        }
      }
    } else if (room && room.phase === "waiting") {
      deletePlayersOfRoom(roomId);
      var sheet2 = getSheet(SHEET_NAME_ROOMS);
      var data3  = sheet2.getDataRange().getValues();
      for (var j = data3.length - 1; j >= 1; j--) {
        if (data3[j][0] === roomId) {
          // Очищаем перед удалением
          sheet2.getRange(j + 1, 1, 1, sheet2.getLastColumn()).clearContent();
          sheet2.deleteRow(j + 1);
          break;
        }
      }
    }
  }

  return { ok: true, message: "Вы вышли из игры" };
}

// ── СПИСОК КОМНАТ (ADMIN) ────────────────────────────────────
function listRoomsAdmin(data, roomTimeoutMs) {
  var password = (data.password || "").trim();
  if (password !== ADMIN_PASSWORD) return { ok: false, error: "Неверный пароль" };
  initSheets();
  cleanupOldRooms(roomTimeoutMs);
  var rooms = readRooms();
  var out = [];
  for (var i = 0; i < rooms.length; i++) {
    var r = rooms[i];
    var n = 0;
    if (r.player1Id) n++;
    if (r.player2Id) n++;
    out.push({
      roomId:        r.roomId,
      phase:         r.phase,
      playerCount:   n,
      player1Nick:   r.player1Nick || "",
      player2Nick:   r.player2Nick || "",
      lastActivity:  r.lastActivity
    });
  }
  return { ok: true, rooms: out };
}

// ── ПЕРЕЗАПУСК ИГРЫ (ADMIN) ──────────────────────────────────
function restartGame(data) {
  var password = (data.password || "").trim();
  var roomId   = data.roomId;
  if (password !== ADMIN_PASSWORD) return { ok: false, error: "Неверный пароль" };

  if (roomId) {
    deletePlayersOfRoom(roomId);
    var sheet = getSheet(SHEET_NAME_ROOMS);
    var data2 = sheet.getDataRange().getValues();
    for (var i = data2.length - 1; i >= 1; i--) {
      if (data2[i][0] === roomId) {
        sheet.getRange(i + 1, 1, 1, sheet.getLastColumn()).clearContent();
        sheet.deleteRow(i + 1);
        break;
      }
    }
    return { ok: true, message: "Комната удалена" };
  }

  // Без roomId — очистить активные данные (история сохраняется)
  var rs = getSheet(SHEET_NAME_ROOMS);
  var rLast = rs.getLastRow();
  if (rLast > 1) rs.deleteRows(2, rLast - 1);

  var ps = getSheet(SHEET_NAME_PLAYERS);
  var pLast = ps.getLastRow();
  if (pLast > 1) ps.deleteRows(2, pLast - 1);

  return { ok: true, message: "Все активные комнаты удалены" };
}